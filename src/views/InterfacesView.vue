<template>
  <div class="page-container api-doc-page">
    <n-card :bordered="false" class="main-card api-doc-card">
      <div class="api-doc-header">
        <div>
          <h2>接口文档</h2>
          <p>给外部系统调用微软邮箱列表、读取邮件和上传账号使用。</p>
        </div>
        <div class="api-doc-header-side">
          <div class="api-doc-base">
            <span>Base URL</span>
            <code>{{ apiBaseUrl }}</code>
          </div>
          <n-button secondary class="api-doc-download-button" @click="downloadCurrentHtml">
            下载 HTML
          </n-button>
        </div>
      </div>

      <n-alert type="info" :bordered="false" class="api-doc-tip">
        外部接口 Key 可在“系统设置 - 接口鉴权”里手动配置、复制或生成新 Key。支持请求头
        <code>{{ mailApiTokenHeader }}</code>，也支持 <code>Authorization: Bearer &lt;KEY&gt;</code>。
      </n-alert>

      <section class="api-doc-section">
        <h3>鉴权说明</h3>
        <p>所有外部读取接口都需要传入开放接口 Key。未传或传错会返回 401。</p>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>Header</th>
              <th>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>{{ mailApiTokenHeader }}</code></td>
              <td>是</td>
              <td>推荐方式，值为系统设置里配置的开放接口 Key。</td>
            </tr>
            <tr>
              <td><code>Authorization</code></td>
              <td>否</td>
              <td>可传 <code>Bearer &lt;KEY&gt;</code>，和上方 Header 二选一。</td>
            </tr>
          </tbody>
        </n-table>
      </section>

      <section class="api-doc-section">
        <h3>查询微软邮箱列表</h3>
        <p>接口说明：查询全部微软邮箱账号列表，返回主邮箱行和别名邮箱行，不返回密码、client_id、client_secret、refresh_token。需要筛选时可传 email 关键词，主邮箱和别名邮箱都会参与匹配。</p>

        <div class="endpoint-line">
          <span>接口地址</span>
          <code>GET /api/external/microsoft/accounts</code>
        </div>

        <h4>请求参数</h4>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>参数</th>
              <th>类型</th>
              <th>必填</th>
              <th>默认值</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>email</code></td>
              <td>string</td>
              <td>否</td>
              <td>-</td>
              <td>邮箱关键词。不传返回全部，传入后按主邮箱或别名邮箱模糊搜索，例如 <code>hotmail</code>、<code>example@outlook.com</code>、<code>example+ava@hotmail.com</code>。</td>
            </tr>
          </tbody>
        </n-table>

        <h4>返回字段</h4>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>字段</th>
              <th>类型</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>items</code></td><td>array</td><td>邮箱账号数组。</td></tr>
            <tr><td><code>id</code></td><td>number</td><td>本系统账号 ID。</td></tr>
            <tr><td><code>account</code></td><td>string</td><td>微软邮箱地址。</td></tr>
            <tr><td><code>rowType</code></td><td>string</td><td><code>primary</code> 表示主邮箱行，<code>alias</code> 表示别名邮箱行。</td></tr>
            <tr><td><code>rowId</code></td><td>string</td><td>列表行唯一 ID，区分主邮箱和别名邮箱。</td></tr>
            <tr><td><code>primaryAccountId</code></td><td>number</td><td>主邮箱账号 ID；别名行也返回所属主邮箱 ID。</td></tr>
            <tr><td><code>primaryAccount</code></td><td>string</td><td>所属主邮箱地址。</td></tr>
            <tr><td><code>aliasId</code></td><td>number | null</td><td>别名 ID；主邮箱行返回 null。</td></tr>
            <tr><td><code>aliases</code></td><td>array</td><td>主邮箱已创建的本地别名邮箱列表。</td></tr>
            <tr><td><code>aliasCount</code></td><td>number</td><td>主邮箱当前别名数量。</td></tr>
            <tr><td><code>matchedAlias</code></td><td>string | null</td><td>别名行返回当前别名邮箱；主邮箱行返回 null。</td></tr>
            <tr><td><code>remark</code></td><td>string</td><td>账号备注。</td></tr>
            <tr><td><code>authType</code></td><td>string</td><td>账号来源或授权类型。</td></tr>
            <tr><td><code>syncStatus</code></td><td>string</td><td>最近一次取件状态。</td></tr>
            <tr><td><code>syncMessage</code></td><td>string</td><td>最近一次取件说明。</td></tr>
            <tr><td><code>fetchedAt</code></td><td>string</td><td>最近取件时间。</td></tr>
            <tr><td><code>fetchedCount</code></td><td>number</td><td>最近取件数量。</td></tr>
            <tr><td><code>mailFetchProvider</code></td><td>string</td><td>实际使用的取件方式，例如 graph 或 imap。</td></tr>
            <tr><td><code>mailFetchScope</code></td><td>string</td><td>实际使用的权限范围。</td></tr>
            <tr><td><code>createdAt</code></td><td>string</td><td>账号创建时间。</td></tr>
            <tr><td><code>total</code></td><td>number</td><td>本次查询结果数量。</td></tr>
          </tbody>
        </n-table>

        <h4>请求示例</h4>
        <api-code-block :code="externalMicrosoftAccountsCurl" language="bash" />

        <h4>返回示例</h4>
        <api-code-block :code="accountsResponseExample" language="json" />
      </section>

      <section class="api-doc-section">
        <h3>查询微软邮箱邮件</h3>
        <p>接口说明：输入完整邮箱地址读取收件箱，支持传主邮箱或系统内别名邮箱。主邮箱返回该账号所有可读取邮件；别名邮箱会解析到主邮箱取信，并只返回 To/Cc 命中当前别名的邮件，以及微软未返回可判断收件人的邮件。</p>

        <div class="endpoint-line">
          <span>接口地址</span>
          <code>GET /api/external/microsoft/messages</code>
        </div>

        <h4>请求参数</h4>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>参数</th>
              <th>类型</th>
              <th>必填</th>
              <th>默认值</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>email</code></td>
              <td>string</td>
              <td>是</td>
              <td>-</td>
              <td>完整邮箱地址，必须精确匹配一个主邮箱或系统内别名邮箱。</td>
            </tr>
            <tr>
              <td><code>mode</code></td>
              <td>string</td>
              <td>否</td>
              <td>auto</td>
              <td><code>auto</code>、<code>graph</code>、<code>imap</code>。建议外部系统使用默认 <code>auto</code>。</td>
            </tr>
          </tbody>
        </n-table>

        <h4>返回字段</h4>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>字段</th>
              <th>类型</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>account</code></td><td>string</td><td>兼容旧调用的主邮箱字段，当前返回实际取信的主邮箱地址。</td></tr>
            <tr><td><code>requestedEmail</code></td><td>string</td><td>调用方传入的邮箱地址，可能是主邮箱或别名邮箱。</td></tr>
            <tr><td><code>resolvedAccount</code></td><td>string</td><td>实际用于取信的主邮箱地址。</td></tr>
            <tr><td><code>matchedAlias</code></td><td>string | null</td><td>当请求邮箱是别名时返回该别名；主邮箱请求返回 null。</td></tr>
            <tr><td><code>resolvedMode</code></td><td>string</td><td>最终使用的取件方式。</td></tr>
            <tr><td><code>fetchedCount</code></td><td>number</td><td>返回邮件数量。</td></tr>
            <tr><td><code>messages</code></td><td>array</td><td>邮件数组。</td></tr>
            <tr><td><code>id</code></td><td>string</td><td>邮件 ID。</td></tr>
            <tr><td><code>subject</code></td><td>string</td><td>邮件主题。</td></tr>
            <tr><td><code>from</code></td><td>string</td><td>发件人。</td></tr>
            <tr><td><code>toRecipients</code></td><td>array</td><td>微软接口返回的真实收件人列表。</td></tr>
            <tr><td><code>ccRecipients</code></td><td>array</td><td>微软接口返回的真实抄送列表。</td></tr>
            <tr><td><code>matchedRecipients</code></td><td>array</td><td>命中的主邮箱或别名地址。</td></tr>
            <tr><td><code>recipientMatchKind</code></td><td>string</td><td><code>requested</code> 表示命中请求邮箱，<code>other</code> 表示 To/Cc 有其他收件人，<code>unknown</code> 表示微软未返回可判断收件人。</td></tr>
            <tr><td><code>receivedAt</code></td><td>string</td><td>收件时间。</td></tr>
            <tr><td><code>preview</code></td><td>string</td><td>邮件预览。</td></tr>
            <tr><td><code>contentType</code></td><td>string</td><td>正文类型，常见为 html 或 text。</td></tr>
            <tr><td><code>content</code></td><td>string</td><td>邮件正文，外部系统可从这里提取验证码。</td></tr>
            <tr><td><code>folderKind</code></td><td>string</td><td>邮件所在文件夹类型。</td></tr>
            <tr><td><code>folderLabel</code></td><td>string</td><td>邮件所在文件夹显示名。</td></tr>
            <tr><td><code>isRead</code></td><td>boolean</td><td>是否已读。</td></tr>
          </tbody>
        </n-table>

        <h4>请求示例</h4>
        <api-code-block :code="externalMicrosoftMessagesCurl" language="bash" />
        <api-code-block :code="externalMicrosoftAliasMessagesCurl" language="bash" />

        <h4>返回示例</h4>
        <api-code-block :code="messagesResponseExample" language="json" />
      </section>

      <section class="api-doc-section">
        <h3>错误返回</h3>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>HTTP 状态码</th>
              <th>说明</th>
              <th>返回示例</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>400</td>
              <td>参数格式错误，邮件接口 email 为空，或微软取件失败。</td>
              <td><code>{"message":"email 不能为空"}</code></td>
            </tr>
            <tr>
              <td>401</td>
              <td>没有传 Key，或 Key 错误。</td>
              <td><code>{"message":"开放接口令牌无效"}</code></td>
            </tr>
            <tr>
              <td>404</td>
              <td>邮箱不存在。</td>
              <td><code>{"message":"邮箱不存在"}</code></td>
            </tr>
          </tbody>
        </n-table>
      </section>

      <section class="api-doc-section">
        <h3>上传账号接口</h3>
        <p>接口说明：外部平台可以把微软邮箱账号批量写入本系统。字段名可在下面的映射配置中调整。</p>

        <div class="endpoint-line">
          <span>接口地址</span>
          <code>POST {{ ingestEndpointPath }}</code>
        </div>

        <h4>请求头</h4>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>Header</th>
              <th>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>Content-Type</code></td>
              <td>是</td>
              <td><code>application/json</code> 或 <code>text/plain</code>。</td>
            </tr>
            <tr>
              <td><code>{{ ingestTokenHeader }}</code></td>
              <td>是</td>
              <td>上传接口专用 Token。</td>
            </tr>
          </tbody>
        </n-table>

        <h4>请求参数</h4>
        <n-table size="small" :bordered="false" :single-line="false">
          <thead>
            <tr>
              <th>参数</th>
              <th>类型</th>
              <th>必填</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>{{ ingestConfig.accountField }}</code></td><td>string</td><td>是</td><td>邮箱账号。</td></tr>
            <tr><td><code>{{ ingestConfig.passwordField }}</code></td><td>string</td><td>否</td><td>邮箱密码。</td></tr>
            <tr><td><code>{{ ingestConfig.clientIdField }}</code></td><td>string</td><td>否</td><td>Microsoft OAuth client_id。</td></tr>
            <tr><td><code>{{ ingestConfig.clientSecretField }}</code></td><td>string</td><td>否</td><td>Microsoft OAuth client_secret。</td></tr>
            <tr><td><code>{{ ingestConfig.tokenField }}</code></td><td>string</td><td>否</td><td>Microsoft OAuth refresh_token。</td></tr>
            <tr><td><code>{{ ingestConfig.captchaField }}</code></td><td>string</td><td>否</td><td>整行账号数据，按分隔符 <code>{{ ingestConfig.delimiter }}</code> 拆分。</td></tr>
          </tbody>
        </n-table>

        <h4>请求示例</h4>
        <api-code-block :code="curlExample" language="bash" />

        <h4>JSON 示例</h4>
        <api-code-block :code="mappedPayloadExample" language="json" />
      </section>

      <section class="api-doc-section api-config-section">
        <h3>上传字段映射配置</h3>
        <p>这里只影响上传账号接口的字段名，不影响微软邮箱读取接口。</p>

        <n-form label-placement="top">
          <n-grid :cols="24" :x-gap="14" :y-gap="8">
            <n-gi :span="24" :md="8">
              <n-form-item label="分隔符">
                <n-input v-model:value="ingestConfig.delimiter" placeholder="----" />
              </n-form-item>
            </n-gi>
            <n-gi :span="24" :md="8">
              <n-form-item label="captcha 行字段名">
                <n-input v-model:value="ingestConfig.captchaField" placeholder="data" />
              </n-form-item>
            </n-gi>
            <n-gi :span="24" :md="8">
              <n-form-item label="账号字段名">
                <n-input v-model:value="ingestConfig.accountField" placeholder="a" />
              </n-form-item>
            </n-gi>
            <n-gi :span="24" :md="8">
              <n-form-item label="密码字段名">
                <n-input v-model:value="ingestConfig.passwordField" placeholder="p" />
              </n-form-item>
            </n-gi>
            <n-gi :span="24" :md="8">
              <n-form-item label="client_id 字段名">
                <n-input v-model:value="ingestConfig.clientIdField" placeholder="c" />
              </n-form-item>
            </n-gi>
            <n-gi :span="24" :md="8">
              <n-form-item label="client_secret 字段名">
                <n-input v-model:value="ingestConfig.clientSecretField" placeholder="s" />
              </n-form-item>
            </n-gi>
            <n-gi :span="24" :md="8">
              <n-form-item label="refresh_token 字段名">
                <n-input v-model:value="ingestConfig.tokenField" placeholder="t" />
              </n-form-item>
            </n-gi>
          </n-grid>
        </n-form>

        <div class="api-doc-actions">
          <n-button type="primary" :loading="saveIngestLoading" @click="saveIngestConfig">保存映射配置</n-button>
        </div>
      </section>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { NAlert, NButton, NCard, NForm, NFormItem, NGi, NGrid, NInput, NTable } from 'naive-ui';
import ApiCodeBlock from '../components/ApiCodeBlock.vue';
import { useAdminConsole } from '../state/admin-console';
import { downloadBlob } from '../utils/download';

const admin = useAdminConsole();
const {
  siteOrigin,
  isAuthenticated,
  initialDataLoaded,
  ingestConfig,
  ingestEndpointPath,
  ingestTokenHeader,
  mailApiTokenHeader,
  saveIngestLoading,
  loadInitialData,
  saveIngestConfig
} = admin;

const apiBaseUrl = computed(() => siteOrigin.value || 'https://your-domain');

const mappedPayloadExample = computed(() =>
  JSON.stringify(
    {
      [ingestConfig.accountField]: 'example@hotmail.com',
      [ingestConfig.passwordField]: 'your_password',
      [ingestConfig.clientIdField]: 'your_client_id',
      [ingestConfig.clientSecretField]: 'your_client_secret',
      [ingestConfig.tokenField]: 'your_refresh_token'
    },
    null,
    2
  )
);

const curlExample = computed(() => {
  return `curl -X POST "${apiBaseUrl.value}${ingestEndpointPath.value}" \\
  -H "Content-Type: application/json" \\
  -H "${ingestTokenHeader.value}: <INGEST_TOKEN>" \\
  -d '${mappedPayloadExample.value.replace(/\n/g, '')}'`;
});

const externalMicrosoftAccountsCurl = computed(() => {
  return `curl "${apiBaseUrl.value}/api/external/microsoft/accounts" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>"`;
});

const externalMicrosoftMessagesCurl = computed(() => {
  return `curl "${apiBaseUrl.value}/api/external/microsoft/messages?email=example@hotmail.com&mode=auto" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>"`;
});

const externalMicrosoftAliasMessagesCurl = computed(() => {
  return `curl "${apiBaseUrl.value}/api/external/microsoft/messages?email=example+ava@hotmail.com&mode=auto" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>"`;
});

function downloadCurrentHtml(): void {
  const card = document.querySelector('.api-doc-card') as HTMLElement | null;
  if (!card) {
    return;
  }
  const contentRoot = (card.querySelector('.n-card__content') as HTMLElement | null) ?? card;
  const clone = contentRoot.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('button').forEach((button) => button.remove());
  const html = buildStandaloneHtml(`<main class="api-doc-card">${clone.innerHTML}</main>`);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), 'microsoft-mail-api-doc.html');
}

function buildStandaloneHtml(content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>望月工具箱接口文档</title>
  <style>
    :root { --font-sans: "Noto Sans SC", "Fira Sans", "PingFang SC", "Microsoft YaHei", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; --font-mono: "Fira Code", "Cascadia Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace; --text-xs: 12px; --text-sm: 13px; --text-base: 14px; --text-md: 15px; --text-lg: 16px; --text-page-title: 22px; --leading-tight: 1.2; --leading-title: 1.35; --leading-body: 1.5; --leading-relaxed: 1.6; --weight-bold: 700; }
    body { margin: 0; padding: 32px; background: #f3f4f6; color: #0f172a; font-family: var(--font-sans); font-size: var(--text-base); line-height: var(--leading-body); letter-spacing: 0; }
    .api-doc-card { max-width: 1180px; margin: 0 auto; padding: 28px 32px; border-radius: 10px; background: #fff; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
    h2 { margin: 0; font-size: var(--text-page-title); line-height: var(--leading-tight); }
    h3 { margin: 0; font-size: var(--text-lg); line-height: var(--leading-title); }
    h4 { margin: 10px 0 0; font-size: var(--text-md); }
    p { margin: 0; color: #475569; line-height: var(--leading-relaxed); }
    code, pre { color: #1d4ed8; font-family: var(--font-mono); }
    table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
    th, td { padding: 9px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; vertical-align: top; }
    th { color: #334155; background: #f8fafc; }
    .api-doc-header { display: flex; justify-content: space-between; gap: 20px; padding-bottom: 18px; border-bottom: 1px solid #e5e7eb; }
    .api-doc-header-side { display: grid; gap: 10px; flex: none; }
    .api-doc-base { display: grid; gap: 6px; min-width: 260px; padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
    .api-doc-base span { color: #64748b; font-size: 12px; font-weight: 700; }
    .api-doc-tip, .n-alert { margin-top: 18px; padding: 14px; border-radius: 8px; background: #eff6ff; }
    .api-doc-section { display: grid; gap: 12px; padding: 26px 0; border-bottom: 1px solid #e5e7eb; }
    .endpoint-line { display: flex; gap: 12px; padding: 10px 12px; border: 1px solid #dbeafe; border-radius: 8px; background: #eff6ff; }
    .endpoint-line span { color: #1e40af; font-size: 13px; font-weight: 700; }
    .api-code-block { overflow: hidden; border: 1px solid #e5e7eb; border-radius: 8px; background: #f8fafc; }
    .api-code-head { min-height: 40px; padding: 0 12px; display: flex; align-items: center; border-bottom: 1px solid #e5e7eb; color: #64748b; font-size: 12px; font-weight: 700; }
    pre { overflow: auto; margin: 0; padding: 18px 22px; border-radius: 0; background: #f8fafc; color: #0f172a; white-space: pre-wrap; word-break: break-word; line-height: 1.75; }
    @media (max-width: 760px) { body { padding: 12px; } .api-doc-card { padding: 20px 16px; } .api-doc-header, .endpoint-line { flex-direction: column; } .api-doc-header-side, .api-doc-base { min-width: 0; } }
  </style>
</head>
<body>${content}</body>
</html>`;
}

const accountsResponseExample = JSON.stringify(
  {
    items: [
      {
        id: 90,
        account: 'example@hotmail.com',
        rowType: 'primary',
        rowId: 'account-90',
        primaryAccountId: 90,
        primaryAccount: 'example@hotmail.com',
        aliasId: null,
        aliases: ['example+ava@hotmail.com'],
        aliasCount: 1,
        matchedAlias: null,
        remark: '',
        authType: 'manual',
        syncStatus: 'fetch_success',
        syncMessage: '取件成功(GRAPH)，共 1 封',
        fetchedAt: '2026-05-20 10:42:47',
        fetchedCount: 1,
        mailFetchProvider: 'graph',
        mailFetchScope: 'graph-default',
        createdAt: '2026-05-16 11:33:00'
      },
      {
        id: 90,
        account: 'example+ava@hotmail.com',
        rowType: 'alias',
        rowId: 'alias-12',
        primaryAccountId: 90,
        primaryAccount: 'example@hotmail.com',
        aliasId: 12,
        aliases: ['example+ava@hotmail.com'],
        aliasCount: 1,
        matchedAlias: 'example+ava@hotmail.com',
        remark: '',
        authType: 'manual',
        syncStatus: 'fetch_success',
        syncMessage: '取件成功(GRAPH)，共 1 封',
        fetchedAt: '2026-05-20 10:42:47',
        fetchedCount: 1,
        mailFetchProvider: 'graph',
        mailFetchScope: 'graph-default',
        createdAt: '2026-05-20 10:50:00'
      }
    ],
    total: 2
  },
  null,
  2
);

const messagesResponseExample = JSON.stringify(
  {
    account: 'example@hotmail.com',
    requestedEmail: 'example+ava@hotmail.com',
    resolvedAccount: 'example@hotmail.com',
    matchedAlias: 'example+ava@hotmail.com',
    resolvedMode: 'graph',
    fetchedCount: 1,
    messages: [
      {
        id: 'message-id',
        subject: 'Your verification code',
        from: 'OpenAI <noreply@example.com>',
        toRecipients: [
          {
            name: 'example+ava@hotmail.com',
            address: 'example+ava@hotmail.com',
            display: 'example+ava@hotmail.com'
          }
        ],
        ccRecipients: [],
        matchedRecipients: ['example+ava@hotmail.com'],
        recipientMatchKind: 'requested',
        receivedAt: '2026-05-20T02:30:00Z',
        preview: 'Your verification code is...',
        contentType: 'html',
        content: '<html>验证码内容</html>',
        folderKind: 'inbox',
        folderLabel: '收件箱',
        isRead: false
      }
    ]
  },
  null,
  2
);

onMounted(async () => {
  if (!initialDataLoaded.value && isAuthenticated.value) {
    await loadInitialData();
  }
});
</script>

<style scoped>
.api-doc-page {
  display: flex;
  justify-content: center;
}

.api-doc-card {
  width: min(1180px, 100%);
}

.api-doc-card :deep(.n-card__content) {
  padding: 28px 32px;
}

.api-doc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding-bottom: 18px;
  border-bottom: 1px solid #e5e7eb;
}

.api-doc-header h2 {
  margin: 0;
  color: #0f172a;
  font-size: var(--text-page-title);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
}

.api-doc-header p {
  margin: 8px 0 0;
  color: #64748b;
  font-size: var(--text-sm);
  line-height: 1.45;
}

.api-doc-header-side {
  display: grid;
  gap: 10px;
  justify-items: stretch;
  flex: none;
}

.api-doc-base {
  display: grid;
  gap: 6px;
  min-width: 260px;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.api-doc-base span {
  color: #64748b;
  font-size: var(--text-xs);
  font-weight: var(--weight-bold);
}

.api-doc-download-button {
  min-height: 36px;
}

.api-doc-base code,
.endpoint-line code,
.api-doc-section code {
  color: #1d4ed8;
  font-family: var(--font-mono);
}

.api-doc-tip {
  margin-top: 18px;
  border-radius: 8px;
}

.api-doc-section {
  display: grid;
  gap: 12px;
  padding: 26px 0;
  border-bottom: 1px solid #e5e7eb;
}

.api-doc-section:last-child {
  border-bottom: 0;
}

.api-doc-section h3 {
  margin: 0;
  color: #0f172a;
  font-size: var(--text-lg);
  font-weight: var(--weight-bold);
  line-height: var(--leading-title);
}

.api-doc-section h4 {
  margin: 10px 0 0;
  color: #1e293b;
  font-size: 15px;
}

.api-doc-section p {
  margin: 0;
  color: #475569;
  font-size: var(--text-base);
  line-height: var(--leading-relaxed);
}

.endpoint-line {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  background: #eff6ff;
}

.endpoint-line span {
  flex: 0 0 auto;
  color: #1e40af;
  font-size: var(--text-sm);
  font-weight: var(--weight-bold);
}

.api-doc-section :deep(.n-table) {
  font-size: var(--text-sm);
}

.api-doc-section :deep(th) {
  color: #334155;
  font-weight: 700;
  background: #f8fafc;
}

.api-doc-section :deep(td) {
  vertical-align: top;
}

.api-config-section {
  background: #fbfdff;
}

.api-doc-actions {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 760px) {
  .api-doc-card :deep(.n-card__content) {
    padding: 20px 16px;
  }

  .api-doc-header,
  .endpoint-line {
    align-items: stretch;
    flex-direction: column;
  }

  .api-doc-header-side,
  .api-doc-base {
    min-width: 0;
  }
}
</style>
