#!/usr/bin/env python3
"""Dian115 浏览器登录：Camoufox 过 Cloudflare Turnstile 后返回 __Host-portal_token。

移植自 Automation Toolbox 的成熟方案（apps/proxyscrape/providers/turnstile/camoufox_provider.py）：
- Camoufox headed 模式 + humanize + block_webrtc + geoip（指纹与出口 IP 对齐）；
- Turnstile 复选框用坐标点击（iframe 左侧 24px 垂直居中）：新版 Turnstile 是 canvas 渲染，
  iframe 内没有 checkbox DOM，DOM 点击不可靠；
- 拟人化输入（逐字符键盘事件、思考停顿）；
- 轮询 cf-turnstile-response / __Host-portal_token cookie，而非一次性点击后干等。

被 Node.js 端（dian115-checkin.ts）通过 child_process 调用：
  stdin:  {"email": "...", "password": "..."}        // 密码不在命令行、不落日志
  stdout: {"ok": true, "token": "eyJ..."}             // 过程日志全部走 stderr

依赖：camoufox[geoip] + playwright + cryptography（需先执行 python -m camoufox fetch）。
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

try:
    from camoufox.sync_api import Camoufox
    from playwright.sync_api import TimeoutError as PlaywrightTimeout
except ImportError as e:
    print(json.dumps({"ok": False, "error": f"缺少依赖: {e}；需安装 camoufox[geoip] 并执行 python -m camoufox fetch"}))
    sys.exit(1)

BASE = "https://m.dian115.com"   # __Host- cookie 绑定 host，必须用 m 域登录
LOGIN_URL = f"{BASE}/login"
TOTAL_TIMEOUT_S = 180            # 登录循环超时
TURNSTILE_CLICK_INTERVAL = 3.0   # Turnstile 两次点击的最小间隔（防狂点被判机器）


def log(msg: str) -> None:
    """过程日志走 stderr，不污染 stdout 的 JSON 契约。"""
    print(f"[Dian115BrowserLogin] {msg}", file=sys.stderr, flush=True)


def launch_options() -> dict:
    """Camoufox 启动配置（照抄 Automation Toolbox shared/browser/camoufox.py）。"""
    options = {
        "headless": True,           # 服务器无显示器；本方案过盾不依赖可见窗口（人类化轨迹由 humanize 提供）
        "window": (1280, 900),
        "humanize": 0.4,           # 内置人类化鼠标移动（贝塞尔轨迹）
        "block_webrtc": True,       # 防 WebRTC 泄漏真实 IP
        "i_know_what_im_doing": True,
        "geoip": True,              # 按出口 IP 自动对齐时区/语言/经纬度
    }
    import os
    if os.name == "nt":
        options["firefox_user_prefs"] = {
            # Windows 下软化 GPU 要求（避免渲染异常导致验证失败）
            "gfx.webrender.all": False,
            "gfx.webrender.software": True,
            "layers.acceleration.disabled": True,
            "media.hardware-video-decoding.enabled": False,
        }
    return options


def find_turnstile_frame(page):
    """遍历 frames 定位 challenges.cloudflare.com 的 frame。"""
    for frame in page.frames:
        url = str(frame.url or "")
        if "challenges.cloudflare.com" in url or "turnstile" in url.lower():
            return frame
    return None


def click_turnstile(page) -> bool:
    """坐标点击 Turnstile 复选框（双策略，移植自 Toolbox camoufox_provider）。

    策略1: Turnstile frame 内 body 坐标 (24, h/2) 点击；
    策略2: 失败则取 iframe bounding box，在 page 级坐标点击（带鼠标轨迹）。
    """
    turnstile_frame = find_turnstile_frame(page)
    if turnstile_frame is None:
        return False

    # 策略1：frame 内 body 坐标点击
    try:
        body_info = turnstile_frame.evaluate(
            "() => { const b = document.body; if (!b) return null;"
            " const r = b.getBoundingClientRect();"
            " return {w: r.width, h: r.height}; }"
        )
        if body_info and body_info.get("w", 0) > 0:
            x = 24.0
            y = float(body_info["h"]) / 2
            turnstile_frame.locator("body").click(position={"x": x, "y": y}, timeout=3000)
            log(f"已点击 Turnstile frame body ({x:.0f},{y:.0f})")
            return True
    except Exception as e:
        log(f"frame 内点击失败: {type(e).__name__}")

    # 策略2：page 级 iframe 坐标点击（带鼠标轨迹）
    try:
        iframe_el = page.query_selector(
            'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'
        )
        if iframe_el:
            box = iframe_el.bounding_box()
            if box and box["width"] > 0:
                px = box["x"] + 24.0
                py = box["y"] + box["height"] / 2
                page.mouse.move(px - 40, py - 25)
                page.mouse.move(px, py, steps=12)
                page.mouse.down()
                time.sleep(0.06)
                page.mouse.up()
                log(f"已在 page 级点击 Turnstile iframe ({px:.0f},{py:.0f})")
                return True
    except Exception as e:
        log(f"page 级点击失败: {type(e).__name__}")
    return False


def get_token_cookie(context) -> str | None:
    """从浏览器 cookies 提取 __Host-portal_token。"""
    try:
        for c in context.cookies(BASE):
            if c.get("name") == "__Host-portal_token" and c.get("value"):
                return c["value"]
    except Exception:
        pass
    return None


# Turnstile 是否已通过：读 cf-turnstile-response 隐藏域（或 turnstile.getResponse()）
CF_TOKEN_JS = """(() => {
  const byInput = String((document.querySelector(
      'input[name="cf-turnstile-response"]') || {}).value || '').trim();
  if (byInput) return byInput;
  try {
    if (window.turnstile && typeof turnstile.getResponse === 'function') {
      return String(turnstile.getResponse() || '').trim();
    }
  } catch(e) {}
  return '';
})()"""


def cf_turnstile_token(page) -> str:
    """当前 Turnstile 的通行 token；空串表示尚未通过。"""
    try:
        return str(page.evaluate(CF_TOKEN_JS) or "").strip()
    except Exception:
        return ""


TOAST_JS = """(() => {
  const els = document.querySelectorAll(
    '[class*=toast],[class*=Toast],[role=alert],[class*=message] li,[class*=error]'
  );
  const out = [];
  for (const el of els) {
    const t = (el.innerText || '').trim();
    if (t && t.length < 100 && el.offsetParent) out.push(t);
  }
  return out.slice(0, 3).join(' | ');
})()"""


def read_toast(page) -> str:
    try:
        return str(page.evaluate(TOAST_JS) or "").strip()
    except Exception:
        return ""


def type_like_human(page, locator, text: str) -> None:
    """逐字符输入（非 fill 一次性灌入），保持与真人一致的键盘事件序列。"""
    locator.click()
    for ch in text:
        locator.type(ch, delay=60)
        time.sleep(0.05 + (0.08 if ch in "@._-" else 0))


def main() -> None:
    if sys.platform == "win32":
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    result = {"ok": False, "token": None, "error": None}
    try:
        input_data = json.load(sys.stdin)
        email = str(input_data.get("email", "")).strip()
        password = str(input_data.get("password", "")).strip()
        if not email or not password:
            print(json.dumps({"ok": False, "error": "邮箱或密码为空"}))
            sys.exit(1)

        log(f"开始浏览器登录: {email}")
        with Camoufox(**launch_options()) as browser:
            context = browser.new_context(no_viewport=True)
            page = context.new_page()
            page.on("pageerror", lambda _e: None)  # 忽略 SPA 噪音

            # Step 1: 打开登录页
            log(f"访问 {LOGIN_URL}")
            page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=45_000)
            try:
                page.wait_for_load_state("networkidle", timeout=20_000)
            except PlaywrightTimeout:
                log("networkidle 超时（正常，SPA 长连接），继续")

            # Step 2: 等表单渲染并逐字符填写
            email_input = page.locator('input[type="email"], input[placeholder*="邮箱"]').first
            password_input = page.locator('input[type="password"]').first
            email_input.wait_for(state="visible", timeout=20_000)
            log("登录表单已渲染，填写中...")
            type_like_human(page, email_input, email)
            time.sleep(0.6)
            type_like_human(page, password_input, password)

            # Step 3: 登录循环——过盾 → 提交 → 检测登录态。
            # Turnstile 内嵌在登录表单页：cf-turnstile-response 有值才允许提交登录；
            # 若点登录后又提示「请完成人机验证」（token 被消费/过期）→ 回去过盾再点。
            login_btn = page.locator(
                'button:has-text("登录"), button:has-text("登 录"), button[type="submit"]'
            ).first
            login_btn.wait_for(state="visible", timeout=10_000)

            login_deadline = time.monotonic() + TOTAL_TIMEOUT_S
            last_cf_click = -100.0
            last_login_click = -100.0
            token = None
            login_clicked = False
            last_toast = ""
            import re
            while time.monotonic() < login_deadline:
                token = get_token_cookie(context)
                if token:
                    log("检测到 __Host-portal_token，登录成功")
                    break

                # 硬错误 toast（密码错误等）直接退出，不空转到超时
                toast = read_toast(page)
                if toast and toast != last_toast:
                    log(f"页面提示: {toast}")
                    last_toast = toast
                    if re.search(r"密码错误|账号不存在|邮箱不存在|密码不正确|尝试次数", toast):
                        raise RuntimeError(f"登录被拒: {toast}")

                cf_token = cf_turnstile_token(page)
                has_widget = find_turnstile_frame(page) is not None
                if len(cf_token) < 80:
                    # 盾还没过：坐标点击（限频，避免狂点被判定机器）
                    if has_widget and time.monotonic() - last_cf_click >= TURNSTILE_CLICK_INTERVAL:
                        click_turnstile(page)
                        last_cf_click = time.monotonic()
                else:
                    # 盾已通过：提交登录
                    if time.monotonic() - last_login_click >= 5.0:
                        log("Turnstile 已通过，点击登录...")
                        try:
                            login_btn.click()
                            login_clicked = True
                            last_login_click = time.monotonic()
                        except Exception as e:
                            log(f"点击登录按钮失败: {type(e).__name__}")

                # 无盾站点兜底：直接提交
                if not has_widget and len(cf_token) < 80 and not login_clicked and time.monotonic() - last_login_click >= 5.0:
                    log("未检测到 Turnstile，直接点击登录...")
                    login_btn.click()
                    login_clicked = True
                    last_login_click = time.monotonic()

                page.wait_for_timeout(500)
            else:
                raise RuntimeError("等待登录超时（Turnstile 未通过或站点无响应）")

            if not token:
                token = get_token_cookie(context)
            if not token:
                raise RuntimeError("登录流程结束但未拿到 __Host-portal_token")

            result["ok"] = True
            result["token"] = token
            log(f"登录成功，token 长度 {len(token)}")
            print(json.dumps(result, ensure_ascii=False))

    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
