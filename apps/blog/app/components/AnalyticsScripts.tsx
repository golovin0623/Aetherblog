import Script from 'next/script';

// AnalyticsScripts —— 按后台「系统设置 → SEO」配置的统计 ID 注入第三方分析脚本。
// 在此组件之前，baidu_analytics_id / google_analytics_id 两个设置在前台完全无人消费
// （纯架子）：管理员填了 ID 也不会有任何埋点。这里补齐真实注入。
//
// 安全：ID 来自受信任的管理员后台，但仍做格式白名单（仅字母/数字/下划线/连字符），
// 杜绝把任意字符串插进 <script> src / 行内脚本造成注入。
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return ID_RE.test(trimmed) ? trimmed : null;
}

interface Props {
  baiduId?: unknown;
  googleId?: unknown;
}

export default function AnalyticsScripts({ baiduId, googleId }: Props) {
  const baidu = sanitizeId(baiduId);
  const google = sanitizeId(googleId);

  if (!baidu && !google) return null;

  return (
    <>
      {google && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${google}`}
            strategy="afterInteractive"
          />
          <Script id="ga-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${google}');`}
          </Script>
        </>
      )}
      {baidu && (
        <Script id="baidu-tongji" strategy="afterInteractive">
          {`var _hmt = _hmt || [];
(function() {
  var hm = document.createElement("script");
  hm.src = "https://hm.baidu.com/hm.js?${baidu}";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(hm, s);
})();`}
        </Script>
      )}
    </>
  );
}
