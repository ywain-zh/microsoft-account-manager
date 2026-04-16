<template>
  <div class="page-stack interface-page">
    <section class="page-intro-card page-intro-card-split">
      <div class="page-intro-copy">
        <p class="page-intro-eyebrow">Interfaces & Docs</p>
        <h3>接口配置与调用文档</h3>
        <p>统一查看上传映射规则、开放 API 说明和后台管理接口，方便前后端联调与维护。</p>
      </div>

      <div class="page-intro-stats">
        <div class="page-stat-tile">
          <span class="page-stat-label">Base URL</span>
          <strong class="page-stat-value page-stat-value-code">{{ apiBaseUrl }}</strong>
        </div>
        <div class="page-stat-tile">
          <span class="page-stat-label">上传鉴权头</span>
          <strong class="page-stat-value page-stat-value-code">{{ ingestTokenHeader }}</strong>
        </div>
      </div>
    </section>

    <div class="interface-grid interface-grid-balanced">
      <n-card :bordered="false" size="small" class="content-card interface-card">
        <div class="card-section-stack">
          <div class="card-section-header">
            <p class="section-kicker">Upload Endpoint</p>
            <h3 class="section-title">外部上传接口说明</h3>
            <p class="section-copy">用于外部平台向系统批量写入账号数据，适合自动化导入流程。</p>
          </div>

          <div class="api-box">
            <p><strong>接口地址：</strong>{{ ingestEndpointUrl }}</p>
            <p><strong>请求方法：</strong>POST</p>
            <p><strong>Content-Type：</strong>application/json 或 text/plain</p>
            <p><strong>鉴权头：</strong>{{ ingestTokenHeader }}: &lt;INGEST_TOKEN&gt;</p>
          </div>
        </div>
      </n-card>

      <n-card :bordered="false" size="small" class="content-card interface-card">
        <div class="card-section-stack">
          <div class="card-section-header">
            <p class="section-kicker">Mapping Config</p>
            <h3 class="section-title">上传字段映射配置</h3>
            <p class="section-copy">保留现有字段绑定与保存逻辑，只对表单分组与视觉层次做前端重构。</p>
          </div>

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
                <n-form-item label="refresh_token 字段名">
                  <n-input v-model:value="ingestConfig.tokenField" placeholder="t" />
                </n-form-item>
              </n-gi>
            </n-grid>
          </n-form>

          <div class="section-actions">
            <n-button class="section-primary-button" type="primary" :loading="saveIngestLoading" @click="saveIngestConfig">
              保存映射配置
            </n-button>
          </div>
        </div>
      </n-card>
    </div>

    <n-card :bordered="false" title="请求示例" size="small" class="content-card interface-card">
      <div class="card-section-stack">
        <div class="card-section-header">
          <p class="section-kicker">Examples</p>
          <h3 class="section-title">常用请求示例</h3>
          <p class="section-copy">用同一套视觉规范整理 JSON 与 curl 示例，方便复制和对照字段结构。</p>
        </div>

        <n-space vertical class="code-example-stack">
          <p class="hint">示例 1（captchaurn 格式）：</p>
          <n-code :code="captchaPayloadExample" language="json" word-wrap />
          <p class="hint">示例 2（字段映射格式）：</p>
          <n-code :code="mappedPayloadExample" language="json" word-wrap />
          <p class="hint">curl 示例：</p>
          <n-code :code="curlExample" language="bash" word-wrap />
        </n-space>
      </div>
    </n-card>

    <n-card :bordered="false" title="接口总览" size="small" class="content-card interface-card">
      <div class="card-section-stack">
        <div class="card-section-header">
          <p class="section-kicker">Overview</p>
          <h3 class="section-title">接口总览</h3>
          <p class="section-copy">快速查看开放 API 与后台 API 的关键入口，减少在多个文档间来回切换。</p>
        </div>

        <p class="hint">Base URL：{{ apiBaseUrl }}</p>
        <ul class="api-list">
          <li><code>POST /api/upload/ingest</code>：外部平台上传账号到本系统（token 鉴权）。</li>
          <li><code>GET /api/open/accounts</code>：获取账号列表（开放 API，支持 keyword 查询）。</li>
          <li>
            <code>GET /api/open/accounts/:id/messages?mode=auto|graph|imap</code>
            ：按账号 ID 获取合并后的收件箱与垃圾邮件，默认 <code>auto</code>。
          </li>
          <li>
            <code>POST /api/open/messages</code>
            ：按账号 ID 或邮箱地址获取全部邮件（开放 API，响应含 <code>resolvedMode</code>）。
          </li>
          <li><code>PATCH /api/open/accounts/:id/remark</code>：更新指定账号备注（开放 API）。</li>
          <li><code>DELETE /api/open/accounts/:id</code>：删除指定账号（开放 API，token 鉴权）。</li>
          <li><code>POST /api/auth/login</code>：后台登录，登录后可调用管理端 API。</li>
        </ul>
      </div>
    </n-card>

    <div class="interface-grid">
      <n-card :bordered="false" title="开放取件 API（Token 鉴权）" size="small" class="content-card interface-card">
        <div class="card-section-stack">
          <div class="card-section-header">
            <p class="section-kicker">Open API</p>
            <h3 class="section-title">开放取件接口</h3>
            <p class="section-copy">用于外部服务按账号 ID 或邮箱地址取件，并支持备注更新与账号删除。</p>
          </div>

          <n-space vertical class="code-example-stack">
            <p class="hint">支持 Header：{{ mailApiTokenHeader }} 或 Authorization: Bearer token。</p>
            <p class="hint">
              管理后台默认使用 <code>mode=auto</code>，会优先尝试 Graph，失败后回退 Outlook/IMAP 兼容读取。
            </p>
            <p class="hint">获取账号列表：</p>
            <n-code :code="openApiCurlListAccounts" language="bash" word-wrap />
            <p class="hint">按账号 ID 取件：</p>
            <n-code :code="openApiCurlById" language="bash" word-wrap />
            <p class="hint">按邮箱地址取件：</p>
            <n-code :code="openApiCurlByAccount" language="bash" word-wrap />
            <p class="hint">更新账号备注：</p>
            <n-code :code="openApiCurlUpdateRemark" language="bash" word-wrap />
            <p class="hint">删除账号：</p>
            <n-code :code="openApiCurlDeleteAccount" language="bash" word-wrap />
          </n-space>
        </div>
      </n-card>

      <n-card :bordered="false" title="管理端 API（登录会话）" size="small" class="content-card interface-card">
        <div class="card-section-stack">
          <div class="card-section-header">
            <p class="section-kicker">Admin API</p>
            <h3 class="section-title">管理端接口</h3>
            <p class="section-copy">保留当前登录态调用方式，用更清晰的文档排版呈现管理端接口清单与调用示例。</p>
          </div>

          <n-space vertical class="code-example-stack">
            <n-code :code="adminApiDoc" language="text" word-wrap />
            <p class="hint">登录并使用 Cookie 调用管理端接口：</p>
            <n-code :code="adminLoginCurl" language="bash" word-wrap />
          </n-space>
        </div>
      </n-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import {
  NButton,
  NCard,
  NCode,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NSpace
} from 'naive-ui';
import { useAdminConsole } from '../state/admin-console';

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

const ingestEndpointUrl = computed(() => {
  return siteOrigin.value ? `${siteOrigin.value}${ingestEndpointPath.value}` : ingestEndpointPath.value;
});

const captchaPayloadExample = computed(() => {
  const key = ingestConfig.captchaField;
  const delimiter = ingestConfig.delimiter;
  const value = `your_account${delimiter}your_password${delimiter}your_client_id${delimiter}your_refresh_token`;
  return JSON.stringify({ [key]: value }, null, 2);
});

const mappedPayloadExample = computed(() =>
  JSON.stringify(
    {
      [ingestConfig.accountField]: 'your_account',
      [ingestConfig.passwordField]: 'your_password',
      [ingestConfig.clientIdField]: 'your_client_id',
      [ingestConfig.tokenField]: 'your_refresh_token'
    },
    null,
    2
  )
);

const curlExample = computed(() => {
  return `curl -X POST '${ingestEndpointUrl.value}' \\
  -H 'Content-Type: application/json' \\
  -H '${ingestTokenHeader.value}: <INGEST_TOKEN>' \\
  -d '${captchaPayloadExample.value.replace(/\n/g, '')}'`;
});

const openApiCurlListAccounts = computed(() => {
  return `curl "${apiBaseUrl.value}/api/open/accounts?keyword=outlook" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>"`;
});

const openApiCurlById = computed(() => {
  return `curl "${apiBaseUrl.value}/api/open/accounts/1/messages?mode=auto" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>"`;
});

const openApiCurlByAccount = computed(() => {
  return `curl -X POST "${apiBaseUrl.value}/api/open/messages" \\
  -H "Content-Type: application/json" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>" \\
  -d '{"account":"example@outlook.com","mode":"auto"}'`;
});

const openApiCurlUpdateRemark = computed(() => {
  return `curl -X PATCH "${apiBaseUrl.value}/api/open/accounts/1/remark" \\
  -H "Content-Type: application/json" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>" \\
  -d '{"remark":"需要重点跟进"}'`;
});

const openApiCurlDeleteAccount = computed(() => {
  return `curl -X DELETE "${apiBaseUrl.value}/api/open/accounts/1" \\
  -H "${mailApiTokenHeader.value}: <MAIL_API_TOKEN>"`;
});

const adminApiDoc = `POST /api/auth/login                     后台管理员登录
POST /api/auth/logout                    退出登录
GET  /api/auth/me                        获取当前登录用户
GET  /api/accounts                       获取账号列表
POST /api/accounts                       新增账号
PUT  /api/accounts/:id                   更新账号
DELETE /api/accounts/:id                 删除账号
POST /api/accounts/import                批量导入账号
PATCH /api/accounts/:id/remark           更新备注
POST /api/accounts/refresh               检测并刷新 refresh_token
GET  /api/accounts/:id/messages?mode=... 管理端按账号取件（默认 auto）
GET  /api/ingest-config                  获取上传映射配置
PUT  /api/ingest-config                  保存上传映射配置`;

const adminLoginCurl = computed(() => {
  return `curl -c cookie.txt -X POST "${apiBaseUrl.value}/api/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"username":"admin","password":"<ADMIN_PASSWORD>"}'

curl -b cookie.txt "${apiBaseUrl.value}/api/accounts"`;
});

onMounted(async () => {
  if (!initialDataLoaded.value && isAuthenticated.value) {
    await loadInitialData();
  }
});
</script>
