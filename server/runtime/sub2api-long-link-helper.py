import json
import re
import sys
import urllib.parse

CHECKOUT_URL = "https://chatgpt.com/backend-api/payments/checkout"
STRIPE_API_BASE = "https://api.stripe.com/v1"
STRIPE_CHECKOUT_REFERER = "https://checkout.stripe.com/c/pay/{session_id}"
BROWSER_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)
IP_CHECK_URLS = (
    "http://iprust.io/ip.json",
    "https://ipwho.is/",
    "https://api.myip.com/",
    "https://ipinfo.io/json",
)
GOPAY_DEFAULT_BILLING = {
    "name": "Budi Santoso",
    "address": {
        "country": "ID",
        "line1": "Jl. MH Thamrin No. 10",
        "line2": "",
        "city": "Jakarta",
        "state": "DKI Jakarta",
        "postal_code": "10350",
    },
}

try:
    from curl_cffi import requests as curl_requests
except Exception as exc:
    curl_requests = None
    CURL_CFFI_ERROR = str(exc)
else:
    CURL_CFFI_ERROR = ""


def _require_curl_cffi():
    if curl_requests is None:
        raise RuntimeError(
            "长链生成需要 Python 依赖 curl_cffi>=0.14.0。请安装依赖或确认 LONG_LINK_PYTHON 指向包含 curl_cffi 的 Python。"
            + (f" 当前错误：{CURL_CFFI_ERROR}" if CURL_CFFI_ERROR else "")
        )


def _read_stdin_json():
    raw = sys.stdin.read()
    return json.loads(raw or "{}")


def _send(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def _normalize_proxy(value):
    proxy = str(value or "").strip()
    if not proxy:
        return ""
    if "://" not in proxy:
        proxy = "http://" + proxy
    if not re.match(r"^(https?|socks4a?|socks5h?)://", proxy, re.I):
        raise ValueError("代理格式不支持，请使用 http://、https://、socks4://、socks4a://、socks5:// 或 socks5h://")
    return proxy


def _proxy_candidates(value):
    proxy = _normalize_proxy(value)
    if not proxy:
        return [""]

    match = re.match(r"^([a-z0-9+.-]+)://(.+)$", proxy, re.I)
    if not match:
        return [proxy]

    first_scheme = match.group(1).lower()
    rest = match.group(2)
    schemes = [first_scheme]
    for scheme in ("socks5h", "socks5", "http", "https"):
        if scheme not in schemes:
            schemes.append(scheme)
    return [f"{scheme}://{rest}" for scheme in schemes]


def _request_headers(token, accept_language):
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Origin": "https://chatgpt.com",
        "Referer": "https://chatgpt.com/",
        "Accept-Language": accept_language or "en-US,en;q=0.9",
        "User-Agent": BROWSER_USER_AGENT,
    }


def _checkout_payload(body):
    plan = body.get("plan") or "plus"
    mode = body.get("checkout_ui_mode") or "hosted"
    country = (body.get("country") or "US").upper()
    currency = (body.get("currency") or "USD").upper()
    use_promo = bool(body.get("use_promo", True))
    promo_code = _extract_promo_code(body.get("promo_code"))

    payload = {
        "plan_name": "chatgptteamplan" if plan == "team" else "chatgptplusplan",
        "billing_details": {
            "country": country,
            "currency": currency,
        },
        "checkout_ui_mode": mode,
    }

    if plan == "team" and use_promo and promo_code:
        payload["cancel_url"] = f"https://chatgpt.com/?promoCode={urllib.parse.quote(promo_code)}"
        payload["promo_code"] = promo_code
    else:
        payload["cancel_url"] = "https://chatgpt.com/#pricing"

    if use_promo and plan != "team":
        payload["promo_campaign"] = {
            "promo_campaign_id": "plus-1-month-free",
            "is_coupon_from_query_param": True,
        }

    if plan == "team":
        workspace_name = body.get("workspace_name") or "linux-do"
        try:
            seat_quantity = max(2, min(1000, int(body.get("seat_quantity") or 2)))
        except (TypeError, ValueError):
            seat_quantity = 2
        payload["team_plan_data"] = {
            "workspace_name": workspace_name,
            "price_interval": "month",
            "seat_quantity": seat_quantity,
        }

    return payload


def _extract_promo_code(value):
    text = str(value or "").strip()
    if not text:
        return ""
    match = re.search(r"[?&]promoCode=([^&#\s]+)", text, re.I)
    if match:
        return urllib.parse.unquote(match.group(1)).strip()
    return text


def _http_request(method, url, headers=None, body=None, proxy="", allow_redirects=True, timeout=30, json_body=None):
    _require_curl_cffi()
    last_error = ""
    for candidate in _proxy_candidates(proxy):
        try:
            proxies = {"http": candidate, "https": candidate} if candidate else None
            response = curl_requests.request(
                method,
                url,
                data=body,
                json=json_body,
                headers=headers or {},
                impersonate="chrome136",
                proxies=proxies,
                timeout=timeout,
                allow_redirects=allow_redirects,
            )
            return response.status_code, response.text, dict(response.headers), str(response.url), candidate
        except Exception as exc:
            last_error = str(exc)
            continue
    raise RuntimeError(last_error or "请求失败")


def _call_checkout(token, payload, proxy, accept_language):
    status, text, _headers, _final_url, proxy_used = _http_request(
        "POST",
        CHECKOUT_URL,
        headers=_request_headers(token, accept_language),
        json_body=payload,
        proxy=proxy,
        timeout=30,
    )
    if _looks_like_cloudflare_challenge(text):
        raise RuntimeError("请求被 Cloudflare 拦截，请确认运行环境已安装 curl_cffi 并更换代理出口重试。")
    data = _parse_response_json(text)
    if isinstance(data, dict) and proxy_used:
        data["proxy_used"] = proxy_used
    if status >= 400:
        raise RuntimeError(_api_error_message(data, f"ChatGPT checkout 请求失败 ({status})"))
    return status, _enrich_links(data)


def _check_proxy_ip(proxy):
    _require_curl_cffi()
    last_error = ""
    for candidate in _proxy_candidates(proxy):
        proxies = {"http": candidate, "https": candidate} if candidate else None
        for url in IP_CHECK_URLS:
            try:
                response = curl_requests.get(
                    url,
                    headers={"Accept": "application/json", "User-Agent": BROWSER_USER_AGENT},
                    impersonate="chrome136",
                    proxies=proxies,
                    timeout=15,
                )
                if response.status_code >= 400:
                    last_error = f"{url} returned {response.status_code}"
                    continue
                data = _normalize_ip_check_response(_parse_response_json(response.text))
                if isinstance(data, dict) and candidate:
                    data["proxy_used"] = candidate
                return data
            except Exception as exc:
                last_error = str(exc)
    raise RuntimeError(last_error or "代理检测失败")


def _stripe_headers(session_id):
    return {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://checkout.stripe.com",
        "Referer": STRIPE_CHECKOUT_REFERER.format(session_id=session_id),
        "User-Agent": BROWSER_USER_AGENT,
    }


def _stripe_post_form(path, form, session_id, proxy=""):
    status, text, resp_headers, final_url, _proxy_used = _http_request(
        "POST",
        f"{STRIPE_API_BASE}/{path.lstrip('/')}",
        headers=_stripe_headers(session_id),
        body=urllib.parse.urlencode({k: v for k, v in form.items() if v is not None}),
        proxy=proxy,
        timeout=30,
    )
    return status, _parse_response_json(text), resp_headers, final_url


def _stripe_checkout_url(session_id):
    return STRIPE_CHECKOUT_REFERER.format(session_id=session_id)


def _stripe_return_url(session_id):
    return f"https://pay.openai.com/c/pay/{session_id}?redirect_pm_type=gopay&lid=local&ui_mode=hosted"


def _stripe_due_amount(page):
    if not isinstance(page, dict):
        return 0
    total_summary = page.get("total_summary") if isinstance(page.get("total_summary"), dict) else {}
    invoice = page.get("invoice") if isinstance(page.get("invoice"), dict) else {}
    line_item_group = page.get("line_item_group") if isinstance(page.get("line_item_group"), dict) else {}
    for value in (
        total_summary.get("due"),
        total_summary.get("total"),
        invoice.get("amount_due"),
        line_item_group.get("total"),
    ):
        if isinstance(value, int):
            return value
    return 0


def _gopay_billing_details(body, page):
    customer = page.get("customer") if isinstance(page, dict) and isinstance(page.get("customer"), dict) else {}
    customer_address = customer.get("address") if isinstance(customer.get("address"), dict) else {}
    default_address = GOPAY_DEFAULT_BILLING["address"]

    def pick(*values):
        for value in values:
            text = str(value or "").strip()
            if text:
                return text
        return ""

    address = {
        "country": "ID",
        "line1": pick(body.get("gopay_line1"), customer_address.get("line1"), default_address["line1"]),
        "line2": pick(body.get("gopay_line2"), customer_address.get("line2"), default_address["line2"]),
        "city": pick(body.get("gopay_city"), customer_address.get("city"), default_address["city"]),
        "state": pick(body.get("gopay_state"), customer_address.get("state"), default_address["state"]),
        "postal_code": pick(body.get("gopay_postal_code"), customer_address.get("postal_code"), default_address["postal_code"]),
    }

    return {
        "name": pick(body.get("gopay_name"), customer.get("name"), GOPAY_DEFAULT_BILLING["name"]),
        "address": address,
    }


def _stripe_create_gopay_payment_method(session_id, publishable_key, billing, proxy=""):
    status, data, _, _ = _stripe_post_form(
        "payment_methods",
        {
            "type": "gopay",
            "billing_details[name]": billing["name"],
            "billing_details[address][country]": billing["address"]["country"],
            "billing_details[address][line1]": billing["address"]["line1"],
            "billing_details[address][line2]": billing["address"]["line2"],
            "billing_details[address][city]": billing["address"]["city"],
            "billing_details[address][state]": billing["address"]["state"],
            "billing_details[address][postal_code]": billing["address"]["postal_code"],
            "key": publishable_key,
        },
        session_id,
        proxy=proxy,
    )
    return status, data


def _stripe_confirm_gopay_payment_page(session_id, publishable_key, payment_method_id, expected_amount, proxy=""):
    status, data, _, _ = _stripe_post_form(
        f"payment_pages/{session_id}/confirm",
        {
            "eid": "NA",
            "payment_method": payment_method_id,
            "expected_payment_method_type": "gopay",
            "return_url": _stripe_return_url(session_id),
            "consent[terms_of_service]": "accepted",
            "expected_amount": str(expected_amount),
            "key": publishable_key,
        },
        session_id,
        proxy=proxy,
    )
    return status, data


def _stripe_follow_redirect_location(url, proxy=""):
    if not url:
        return ""
    status, _text, headers, _final_url, _proxy_used = _http_request(
        "GET",
        url,
        headers={"User-Agent": BROWSER_USER_AGENT},
        proxy=proxy,
        allow_redirects=False,
        timeout=30,
    )
    if 300 <= status < 400:
        return headers.get("Location") or headers.get("location") or ""
    return ""


def _create_gopay_link(token, body, proxy):
    country = (body.get("country") or "").upper()
    currency = (body.get("currency") or "").upper()
    if country != "ID" or currency != "IDR":
        raise ValueError("GoPay 仅支持 ID / IDR，请把地区设为印度尼西亚、币种设为 IDR。")

    checkout_body = dict(body)
    checkout_body["checkout_ui_mode"] = "hosted"
    _checkout_status, checkout_data = _call_checkout(
        token,
        _checkout_payload(checkout_body),
        proxy,
        body.get("accept_language") or "en-US,en;q=0.9",
    )

    session_id = checkout_data.get("checkout_session_id")
    publishable_key = checkout_data.get("publishable_key")
    if not session_id or not publishable_key:
        raise RuntimeError("OpenAI checkout 返回缺少 checkout_session_id 或 publishable_key。")

    init_status, init_data, _, _ = _stripe_post_form(
        f"payment_pages/{session_id}/init",
        {
            "eid": "NA",
            "browser_locale": body.get("locale") or "en-US",
            "browser_timezone": "Asia/Shanghai",
            "redirect_type": "url",
            "key": publishable_key,
        },
        session_id,
        proxy=proxy,
    )
    if init_status >= 400 or not isinstance(init_data, dict):
        raise RuntimeError(_api_error_message(init_data, "Stripe checkout 初始化失败。"))

    expected_amount = _stripe_due_amount(init_data)
    if expected_amount <= 0:
        raise ValueError("当前 checkout 应付金额为 0。GoPay 需要真实应付金额；如果你开启了 Plus 免费月，请先关闭优惠参数再试。")

    billing = _gopay_billing_details(body, init_data)
    payment_method_status, payment_method = _stripe_create_gopay_payment_method(
        session_id, publishable_key, billing, proxy=proxy
    )
    if payment_method_status >= 400 or not isinstance(payment_method, dict):
        raise RuntimeError(_api_error_message(payment_method, "创建 GoPay payment method 失败。"))

    confirm_status, confirm_data = _stripe_confirm_gopay_payment_page(
        session_id,
        publishable_key,
        payment_method.get("id") or "",
        expected_amount,
        proxy=proxy,
    )
    if confirm_status >= 400 or not isinstance(confirm_data, dict):
        raise RuntimeError(_api_error_message(confirm_data, "GoPay confirm 失败。"))

    payment_intent = confirm_data.get("payment_intent") if isinstance(confirm_data.get("payment_intent"), dict) else {}
    next_action = payment_intent.get("next_action") if isinstance(payment_intent.get("next_action"), dict) else {}
    redirect_to_url = next_action.get("redirect_to_url") if isinstance(next_action.get("redirect_to_url"), dict) else {}
    stripe_redirect_url = redirect_to_url.get("url") or ""
    provider_redirect_url = _stripe_follow_redirect_location(stripe_redirect_url, proxy=proxy) if stripe_redirect_url else ""
    stripe_hosted_url = _stripe_checkout_url(session_id)

    result = dict(checkout_data)
    result.update(
        {
            "link_type": "gopay",
            "checkout_ui_mode": "hosted",
            "payment_method_type": "gopay",
            "stripe_hosted_url": stripe_hosted_url,
            "stripe_redirect_url": stripe_redirect_url,
            "provider_redirect_url": provider_redirect_url,
            "long_url": provider_redirect_url or stripe_redirect_url or checkout_data.get("openai_payurl") or "",
            "fallback": "" if provider_redirect_url else (stripe_redirect_url or checkout_data.get("openai_payurl") or ""),
            "provider_error": "" if provider_redirect_url else "未能从 Stripe 跳转中提取出 GoPay 提供方地址。",
            "expected_amount": expected_amount,
            "gopay_billing_details": billing,
        }
    )
    if body.get("checkout_ui_mode") != "hosted":
        result["checkout_ui_mode_forced"] = "hosted"
    return _enrich_links(result)


def _normalize_ip_check_response(data):
    if not isinstance(data, dict):
        raise RuntimeError("IP 检测服务返回异常")
    connection = data.get("connection") if isinstance(data.get("connection"), dict) else {}
    return {
        "ip": data.get("ip") or data.get("query") or "",
        "country": data.get("country_long") or data.get("country") or data.get("country_name") or "",
        "country_code": data.get("country_short") or data.get("country_code") or data.get("cc") or data.get("countryCode") or "",
        "region": data.get("region") or data.get("region_name") or "",
        "city": data.get("city") or "",
        "timezone": data.get("timezone") or "",
        "isp": connection.get("isp") or data.get("org") or data.get("isp") or "",
        "loc": data.get("loc") or "",
    }


def _parse_response_json(text):
    try:
        return json.loads(text or "{}")
    except json.JSONDecodeError:
        return {"error": text or "返回不是 JSON"}


def _looks_like_cloudflare_challenge(text):
    lowered = (text or "").lower()
    return "_cf_chl_opt" in lowered or "enable javascript and cookies to continue" in lowered or "cf-chl" in lowered


def _api_error_message(data, default="请求失败"):
    if isinstance(data, dict):
        error = data.get("error")
        if isinstance(error, dict):
            return error.get("message") or error.get("code") or default
        if isinstance(error, str):
            return error
        return data.get("message") or default
    return default


def _enrich_links(data):
    if not isinstance(data, dict):
        return data
    session_id = data.get("checkout_session_id")
    processor = data.get("processor_entity")
    if session_id and processor and not data.get("chatgpt_checkout_url"):
        data["chatgpt_checkout_url"] = f"https://chatgpt.com/checkout/{processor}/{session_id}"
    for key in ("url", "stripe_hosted_url", "checkout_url"):
        value = data.get(key)
        if isinstance(value, str) and value.startswith("https://pay.openai.com/"):
            data["openai_payurl"] = value
            break
    if not data.get("link_type"):
        data["link_type"] = "hosted"
    return data


def main():
    try:
        body = _read_stdin_json()
        action = body.get("action")
        if action == "proxy_check":
            data = _check_proxy_ip(_normalize_proxy(body.get("proxy")))
        elif action == "checkout":
            token = str(body.get("token") or "").strip()
            if not token:
                raise ValueError("没有识别到 accessToken")
            proxy = _normalize_proxy(body.get("proxy"))
            link_type = str(body.get("link_type") or "hosted").lower()
            if link_type == "gopay":
                data = _create_gopay_link(token, body, proxy)
            else:
                _status, data = _call_checkout(
                    token,
                    _checkout_payload(body),
                    proxy,
                    body.get("accept_language") or "en-US,en;q=0.9",
                )
        else:
            raise ValueError("未知 helper action")
        _send({"ok": True, "data": data})
    except Exception as exc:
        _send({"ok": False, "error": str(exc)})


if __name__ == "__main__":
    main()
