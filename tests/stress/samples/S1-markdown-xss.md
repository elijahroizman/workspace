---
title: "<img src=x onerror=alert('front')>"
tags: ["<b>x</b>", "<script>alert(1)</script>"]
---
# Markdown XSS

<script>alert('script')</script>
<img src=x onerror="alert('img')">
<svg><script>alert('svg')</script></svg>
<svg onload="alert('svgload')"></svg>
<iframe src="javascript:alert('iframe')"></iframe>
<iframe srcdoc="<script>parent.alert('srcdoc')</script>"></iframe>
<object data="data:text/html,<script>alert('obj')</script>"></object>
<embed src="data:text/html,<script>alert('embed')</script>">
<a href="javascript:alert('a')">a javascript link</a>
<a href="JAVASCRIPT:alert('A')">upper-case javascript link</a>
<a href="data:text/html,<script>alert(1)</script>">a data link</a>
<a href="file:///etc/passwd">a file link</a>
<a href="vbscript:msgbox(1)">vbscript</a>
<a href="#x" onclick="alert('onclick')">onclick</a>
<details open ontoggle="alert('toggle')"><summary>details</summary></details>
<math><mtext><table><mglyph><style><img src=x onerror=alert('mxss')></style></mglyph></table></mtext></math>
<meta http-equiv="refresh" content="0;url=javascript:alert('meta')">
<base href="javascript:alert('base')//">
<form action="javascript:alert('form')"><button>submit</button></form>
<input autofocus onfocus="alert('focus')">
<video><source onerror="alert('video')"></video>
<div style="background:url(javascript:alert('css'))">css</div>
<a href="writan-evil://x">custom scheme</a>

[md javascript](javascript:alert('md'))
[md spaced](<javascript:alert('md2')>)
[md entity](&#106;avascript:alert('ent'))
![img](x" onerror="alert('alt'))
<javascript:alert('autolink')>
<https://example.com/fine>
[relative](../../../../etc/passwd)
[relative doc](other.docx)
![local](/etc/passwd)

---
title: "<img src=x onerror=alert('fm')>"
---
