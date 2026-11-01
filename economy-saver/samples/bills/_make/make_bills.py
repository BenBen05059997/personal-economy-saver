#!/usr/bin/env python3
"""Regenerates every sample bill in economy-saver/samples/bills/.

Everything here is fictional (D20): invented companies, people, addresses, numbers.
Needs only the Python 3 standard library plus Google Chrome (headless) for PDF/PNG
and a system Japanese font (Hiragino on macOS).

    python3 economy-saver/samples/bills/_make/make_bills.py
"""
import base64
import os
import random
import shutil
import subprocess
import sys
import tempfile
from email import policy
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from datetime import datetime, timezone, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)  # .../samples/bills
CHROME = os.environ.get(
    "CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
)
FONT = "'Hiragino Kaku Gothic ProN','Hiragino Sans','ヒラギノ角ゴ ProN','Helvetica Neue',Arial,sans-serif"
MINCHO = "'Hiragino Mincho ProN','ヒラギノ明朝 ProN',serif"
JST = timezone(timedelta(hours=9))
CST = timezone(timedelta(hours=-6))


# ----------------------------------------------------------------- helpers
def barcode_svg(width, height, seed, label=None):
    """Barcode-like stripe drawn as SVG rects (decorative, encodes nothing)."""
    rnd = random.Random(seed)
    x, rects = 0, []
    while x < width - 4:
        w = rnd.choice([1, 1, 2, 2, 3, 4])
        if rnd.random() > 0.38:
            rects.append(f'<rect x="{x}" y="0" width="{w}" height="{height}" fill="#111"/>')
        x += w + rnd.choice([1, 1, 2, 3])
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
            f'viewBox="0 0 {width} {height}">{"".join(rects)}</svg>')


def chrome(args):
    prof = tempfile.mkdtemp(prefix="bills-chrome-")
    try:
        cmd = [CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
               "--hide-scrollbars", "--allow-file-access-from-files",
               f"--user-data-dir={prof}"] + args
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90)
    finally:
        shutil.rmtree(prof, ignore_errors=True)


def render(html, stem, w, h, png=True, pdf=True):
    """Write html, then print PDF (fonts embedded by Chrome) and a 2x PNG."""
    os.makedirs(os.path.join(HERE, "html"), exist_ok=True)
    hp = os.path.join(HERE, "html", stem + ".html")
    with open(hp, "w", encoding="utf-8") as f:
        f.write(html)
    url = "file://" + hp
    if pdf:
        chrome(["--no-pdf-header-footer", f"--print-to-pdf={os.path.join(OUT, stem + '.pdf')}", url])
    if png:
        chrome([f"--screenshot={os.path.join(OUT, stem + '.png')}", f"--window-size={w},{h}",
                "--force-device-scale-factor=2", "--virtual-time-budget=2000", url])


def yen(n):
    return f"{n:,}"


# ----------------------------------------------------------------- Hikari Denki bill
HIKARI = dict(
    total=11220, prev=10020, kwh=412, prev_kwh=371, tax=1020,
    lines=[("基本料金（40A）", "", 1247),
           ("電力量料金 第1段階", "120kWh × 15.00円", 1800),
           ("電力量料金 第2段階", "180kWh × 19.01円", 3422),
           ("電力量料金 第3段階", "112kWh × 23.70円", 2654),
           ("燃料費調整額", "412kWh × 1.60円", 659),
           ("再エネ賦課金", "412kWh × 3.49円", 1438)],
)
assert sum(l[2] for l in HIKARI["lines"]) == HIKARI["total"]
assert HIKARI["tax"] == HIKARI["total"] // 11


def hikari_html():
    h = HIKARI
    rows = "".join(
        f'<tr><td>{n}</td><td class="calc">{c}</td><td class="r">{yen(a)}円</td></tr>'
        for n, c, a in h["lines"])
    chart_data = [("5月", 318), ("6月", 336), ("7月", 360), ("8月", 395), ("9月", 371), ("10月", 412)]
    bars = "".join(
        f'<div class="bar{" cur" if m == "10月" else ""}"><span class="v">{v}</span>'
        f'<i style="height:{int(v / 412 * 92)}px"></i><span class="m">{m}</span></div>'
        for m, v in chart_data)
    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>光電気 電気ご使用量のお知らせ 2026年10月分</title>
<style>
@page {{ size: 210mm 297mm; margin: 0 }}
* {{ box-sizing: border-box; margin: 0; padding: 0 }}
html, body {{ width: 794px; height: 1123px; background: #fff; font-family: {FONT}; color: #222; font-size: 12px }}
.page {{ position: relative; width: 794px; height: 1123px; overflow: hidden; background: #fffefb }}
.band {{ height: 92px; background: linear-gradient(100deg,#f08a00,#f6b21a); color: #fff; padding: 16px 36px; display: flex; align-items: center; justify-content: space-between }}
.logo {{ display: flex; align-items: center; gap: 14px }}
.sun {{ width: 52px; height: 52px }}
.logo b {{ font-size: 26px; letter-spacing: 3px; display: block }}
.logo small {{ font-size: 10px; letter-spacing: 1px; opacity: .95 }}
.title {{ text-align: right }}
.title h1 {{ font-size: 21px; letter-spacing: 2px }}
.title p {{ font-size: 11px; margin-top: 4px }}
.stripe {{ height: 5px; background: #1b4f8a }}
.wrap {{ padding: 20px 36px 0 }}
.row {{ display: flex; gap: 20px }}
.cust {{ flex: 1.15; border: 1px solid #999; padding: 12px 14px; line-height: 1.7 }}
.cust .zip {{ font-size: 11px; color: #555 }}
.cust .nm {{ font-size: 18px; font-weight: 600; margin: 4px 0 }}
.cust dl {{ display: grid; grid-template-columns: 92px 1fr; font-size: 11px; margin-top: 8px; border-top: 1px dotted #aaa; padding-top: 6px }}
.cust dt {{ color: #666 }}
.amt {{ flex: 1; border: 3px solid #1b4f8a; background: #fff }}
.amt .hd {{ background: #1b4f8a; color: #fff; padding: 5px 12px; font-size: 12px; letter-spacing: 2px }}
.amt .big {{ padding: 10px 12px 2px; text-align: right; font-size: 40px; font-weight: 700; color: #111 }}
.amt .big small {{ font-size: 14px; font-weight: 400 }}
.amt .tax {{ text-align: right; font-size: 11px; padding: 0 12px 8px; color: #555 }}
.amt .due {{ display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #1b4f8a; padding: 8px 12px; background: #fff4d6 }}
.amt .due span {{ font-size: 11px }}
.amt .due b {{ font-size: 18px; color: #b3260e }}
.meta {{ margin-top: 12px; display: grid; grid-template-columns: 1.6fr 1fr 1fr; border: 1px solid #999 }}
.meta div {{ padding: 7px 12px; border-right: 1px solid #ccc }}
.meta div:last-child {{ border-right: 0 }}
.meta small {{ display: block; font-size: 10px; color: #666 }}
.meta b {{ font-size: 13px }}
h2 {{ font-size: 13px; margin: 12px 0 5px; padding-left: 8px; border-left: 5px solid #f08a00 }}
table {{ width: 100%; border-collapse: collapse }}
th, td {{ border: 1px solid #bbb; padding: 4px 10px; font-size: 12px; font-weight: 400 }}
th {{ background: #f3efe6; font-weight: 600; text-align: left }}
td.r, th.r {{ text-align: right }}
td.calc {{ color: #555; font-size: 11px }}
tr.sum td {{ background: #fff4d6; font-weight: 700; font-size: 13px }}
.usage {{ display: flex; gap: 20px; align-items: stretch }}
.usage table {{ flex: 1.2 }}
.chart {{ flex: 1; border: 1px solid #bbb; padding: 4px 10px; display: flex; align-items: flex-end; justify-content: space-around; background: #fff }}
.bar {{ display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; width: 38px }}
.bar i {{ display: block; width: 22px; background: #b9c9de }}
.bar.cur i {{ background: #f08a00 }}
.bar .v {{ font-size: 9px; color: #444 }}
.bar .m {{ font-size: 10px; color: #444 }}
.note {{ font-size: 10px; color: #555; margin-top: 6px; line-height: 1.6 }}
.cut {{ position: absolute; left: 0; right: 0; top: 926px; border-top: 2px dashed #888; }}
.cut span {{ position: absolute; left: 36px; top: -9px; background: #fffefb; padding: 0 8px; font-size: 10px; color: #666 }}
.slip {{ position: absolute; left: 36px; right: 36px; top: 940px; height: 142px; border: 1px solid #999; background: #fff; padding: 8px 16px }}
.slip .t {{ display: flex; justify-content: space-between; font-size: 11px; color: #555 }}
.slip .t b {{ font-size: 15px; color: #111; letter-spacing: 1px }}
.slip .cols {{ display: flex; gap: 22px; margin-top: 6px; align-items: flex-end }}
.slip .k {{ font-size: 10px; color: #666 }}
.slip .vv {{ font-size: 15px; font-weight: 600 }}
.slip .bc {{ margin-top: 8px }}
.slip .num {{ font-family: 'Menlo','Courier New',monospace; font-size: 11px; letter-spacing: 2px; margin-top: 4px }}
.foot {{ position: absolute; bottom: 9px; left: 36px; right: 36px; text-align: center; font-size: 10px; color: #8a8a8a }}
.stamp {{ position: absolute; right: 48px; top: 112px; transform: rotate(8deg); border: 2px solid rgba(179,38,14,.6); color: rgba(179,38,14,.7); padding: 2px 8px; font-size: 11px; font-weight: 700; letter-spacing: 1px }}
</style></head><body><div class="page">
<div class="band">
  <div class="logo">
    <svg class="sun" viewBox="0 0 52 52"><circle cx="26" cy="26" r="11" fill="#fff"/>
    {"".join(f'<rect x="24.5" y="2" width="3" height="9" rx="1.5" fill="#fff" transform="rotate({a} 26 26)"/>' for a in range(0,360,45))}</svg>
    <div><b>光電気</b><small>HIKARI DENKI CO., LTD.（架空の会社）</small></div>
  </div>
  <div class="title"><h1>電気ご使用量のお知らせ</h1><p>2026年10月分　ご請求書</p></div>
</div>
<div class="stripe"></div>
<div class="wrap">
  <div class="row">
    <div class="cust">
      <div class="zip">〒000-0000</div>
      <div>東京都架空区サンプル町1丁目2番3号</div>
      <div>サンプルハイツ305号室</div>
      <div class="nm">サンプル　ベン　様</div>
      <dl>
        <dt>お客様番号</dt><dd>99-0000-1234</dd>
        <dt>ご契約種別</dt><dd>従量電灯B（40A）</dd>
        <dt>供給地点</dt><dd>東京都架空区サンプル町1-2-3</dd>
        <dt>お問い合わせ</dt><dd>0120-000-000（架空）</dd>
      </dl>
    </div>
    <div class="amt">
      <div class="hd">ご請求金額（税込）</div>
      <div class="big">¥{yen(h['total'])}<small> 円</small></div>
      <div class="tax">（うち消費税等 {yen(h['tax'])}円）　前月ご請求額 ¥{yen(h['prev'])}</div>
      <div class="due"><span>支払期日</span><b>2026年11月27日（金）</b></div>
    </div>
  </div>
  <div class="meta">
    <div><small>ご使用期間</small><b>2026年9月29日〜10月29日（31日間）</b></div>
    <div><small>検針日</small><b>2026年10月29日</b></div>
    <div><small>請求書発行日</small><b>2026年11月1日</b></div>
  </div>
  <h2>ご使用量</h2>
  <div class="usage">
    <table>
      <tr><th>区分</th><th class="r">ご使用量</th><th class="r">ご請求額（税込）</th></tr>
      <tr><td>今回（10月分）</td><td class="r"><b>{h['kwh']}kWh</b></td><td class="r"><b>{yen(h['total'])}円</b></td></tr>
      <tr><td>前月（9月分）</td><td class="r">{h['prev_kwh']}kWh</td><td class="r">{yen(h['prev'])}円</td></tr>
      <tr><td>前年同月</td><td class="r">389kWh</td><td class="r">9,480円</td></tr>
    </table>
    <div class="chart">{bars}</div>
  </div>
  <h2>ご請求内訳（税込）</h2>
  <table>
    <tr><th>項目</th><th>計算内容</th><th class="r">金額</th></tr>
    {rows}
    <tr class="sum"><td colspan="2">ご請求金額　合計（税込）</td><td class="r">{yen(h['total'])}円</td></tr>
  </table>
  <p class="note">※金額はすべて消費税等10%を含みます。※燃料費調整額・再エネ賦課金は国が定める単価により毎月見直されます。<br>
  ※お支払いは下の払込票をコンビニエンスストアへ、またはマイページ（https://mypage.hikari-denki.example）から。</p>
</div>
<div class="cut"><span>✂ ここから切り取ってください　コンビニエンスストア払込票</span></div>
<div class="slip">
  <div class="t"><span>光電気株式会社（架空）　収納代行　払込票</span><b>¥{yen(h['total'])}</b></div>
  <div class="cols">
    <div><div class="k">お客様番号</div><div class="vv">99-0000-1234</div></div>
    <div><div class="k">ご請求月</div><div class="vv">2026年10月分</div></div>
    <div><div class="k">支払期日</div><div class="vv" style="color:#b3260e">2026年11月27日</div></div>
    <div><div class="k">払込金額（税込）</div><div class="vv">{yen(h['total'])}円</div></div>
  </div>
  <div class="bc">{barcode_svg(640, 38, 20261101)}
  <div class="num">99 0000 1234 2026 1127 0011220 000 SAMPLE</div></div>
</div>
<div class="stamp">SAMPLE　架空</div>
<div class="foot">この請求書はハッカソンのデモ用に作成した架空のものです。実在の企業・個人とは関係ありません。</div>
</div></body></html>"""


# ----------------------------------------------------------------- Kokuho notice
KOKUHO = dict(total=24500, iryo=18300, shien=6200)
assert KOKUHO["iryo"] + KOKUHO["shien"] == KOKUHO["total"]


def kokuho_html():
    k = KOKUHO

    def stub(title, who):
        return f"""<div class="stub"><div class="st">{title}</div>
        <div class="line"><span>世帯主</span><b>サンプル　ベン　様</b></div>
        <div class="line"><span>納付額</span><b class="amt">¥{yen(k['total'])}</b></div>
        <div class="line"><span>納期限</span><b>2026年12月10日</b></div>
        <div class="line"><span>期別</span><b>第6期</b></div>
        <div class="who">{who}</div></div>"""

    return f"""<!doctype html><html lang="ja"><head><meta charset="utf-8">
<title>国民健康保険料 納付書 令和8年度 第6期</title>
<style>
@page {{ size: 794px 470px; margin: 0 }}
* {{ box-sizing: border-box; margin: 0; padding: 0 }}
html, body {{ width: 794px; height: 470px; font-family: {FONT}; color: #1a1a1a; font-size: 12px }}
.page {{ position: relative; width: 794px; height: 470px; overflow: hidden; background: #f3f0e6 }}
.paper {{ position: absolute; inset: 14px; background: #fbfaf4; border: 2px solid #3a6b4a }}
.head {{ display: flex; justify-content: space-between; align-items: center; background: #3a6b4a; color: #fff; padding: 10px 20px }}
.head h1 {{ font-size: 22px; letter-spacing: 6px }}
.head p {{ font-size: 11px; text-align: right; line-height: 1.5 }}
.mid {{ display: flex }}
.stub {{ width: 130px; border-right: 2px dashed #7a8f80; padding: 10px 8px; font-size: 10px; background: #f6f5ec }}
.stub .st {{ font-weight: 700; font-size: 11px; background: #dfe9e0; padding: 3px 4px; margin-bottom: 8px; text-align: center }}
.stub .line {{ display: flex; flex-direction: column; margin-bottom: 7px }}
.stub .line span {{ color: #666; font-size: 9px }}
.stub .line b {{ font-size: 11px }}
.stub .line b.amt {{ font-size: 15px }}
.stub .who {{ margin-top: 10px; font-size: 9px; color: #777; text-align: center }}
.main {{ flex: 1; padding: 12px 18px }}
.title2 {{ font-size: 15px; font-weight: 700; margin-bottom: 8px }}
.title2 small {{ font-weight: 400; font-size: 11px; color: #444; margin-left: 8px }}
.grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 0; border: 1px solid #777 }}
.grid div {{ padding: 4px 10px; border-bottom: 1px solid #ccc; border-right: 1px solid #ccc; display: flex; justify-content: space-between }}
.grid div:nth-child(2n) {{ border-right: 0 }}
.grid span {{ color: #666; font-size: 10px }}
.amtbox {{ margin-top: 10px; display: flex; border: 3px solid #3a6b4a }}
.amtbox .l {{ background: #3a6b4a; color: #fff; padding: 8px 14px; font-size: 13px; white-space: nowrap; display: flex; align-items: center; letter-spacing: 2px }}
.amtbox .n {{ flex: 1; text-align: right; padding: 4px 16px; font-size: 34px; font-weight: 700; background: #fff; white-space: nowrap }}
.amtbox .n small {{ font-size: 14px; font-weight: 400 }}
.due {{ width: 205px; white-space: nowrap; background: #fff4d6; border-left: 3px solid #3a6b4a; padding: 6px 10px; display: flex; flex-direction: column; justify-content: center }}
.due small {{ font-size: 10px; color: #666 }}
.due b {{ font-size: 14px; color: #b3260e }}
.items {{ margin-top: 8px; font-size: 11px; color: #333; display: flex; gap: 22px }}
.pay {{ border-top: 2px dashed #7a8f80; padding: 12px 20px; position: relative; height: 150px }}
.pay .where {{ font-size: 11px; color: #333; line-height: 1.6 }}
.pay .bc {{ margin-top: 10px }}
.pay .num {{ font-family: Menlo,'Courier New',monospace; font-size: 11px; letter-spacing: 2px; margin-top: 4px }}
.pay .q {{ position: absolute; right: 24px; top: 14px; width: 74px; height: 74px; background: #fff; border: 1px solid #333; padding: 4px }}
.stamp {{ position: absolute; right: 100px; top: 318px; transform: rotate(-7deg); border: 2px solid rgba(179,38,14,.55); color: rgba(179,38,14,.65); padding: 2px 8px; font-size: 11px; font-weight: 700; letter-spacing: 1px }}
.foot {{ position: absolute; bottom: 4px; left: 0; right: 0; text-align: center; font-size: 9px; color: #7a7a7a }}
</style></head><body><div class="page"><div class="paper">
<div class="head"><h1>国民健康保険料　納付書</h1><p>架空区役所　国保年金課（架空）<br>令和8年度（2026年度）　第6期分</p></div>
<div class="mid">
  {stub("納付済通知書", "（金融機関保管）")}
  <div class="main">
    <div class="title2">納付書・領収証書<small>〒000-0000　東京都架空区サンプル町1-2-3　サンプルハイツ305</small></div>
    <div class="grid">
      <div><span>世帯主</span><b>サンプル　ベン　様</b></div>
      <div><span>被保険者番号</span><b>00-000123</b></div>
      <div><span>賦課期間</span><b>令和8年4月〜令和9年3月</b></div>
      <div><span>期別</span><b>第6期（全10期）</b></div>
      <div><span>医療分保険料</span><b>{yen(k['iryo'])}円</b></div>
      <div><span>後期高齢者支援金分</span><b>{yen(k['shien'])}円</b></div>
    </div>
    <div class="amtbox"><div class="l">納付額</div><div class="n">¥{yen(k['total'])}<small> 円</small></div>
      <div class="due"><small>納期限</small><b>2026年12月10日（木）</b></div></div>
  </div>
  {stub("領収証書", "（納付者控）")}
</div>
<div class="pay">
  <div class="where">【お支払い場所】　コンビニエンスストア（納期限まで）／ 架空区内の金融機関・郵便局 ／ 区役所会計窓口<br>
  ※納期限を過ぎると使用できません。口座振替をご利用の方は、この納付書でのお支払いは不要です。</div>
  <div class="bc">{barcode_svg(560, 40, 20261210)}<div class="num">99 0000 0123 2026 1210 0024500 006 SAMPLE</div></div>
  <div class="q"><svg width="66" height="66" viewBox="0 0 22 22">{"".join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="#111"/>' for x,y in _qr_cells(22, 77))}</svg></div>
</div>
<div class="stamp">SAMPLE　架空</div>
<div class="foot">この納付書はハッカソンのデモ用に作成した架空のものです。実在の自治体・個人とは関係ありません。</div>
</div></div></body></html>"""


def _qr_cells(n, seed):
    """Decorative QR-like blocks (not a real code) with three finder squares."""
    rnd = random.Random(seed)
    cells = set()
    for ox, oy in [(0, 0), (n - 7, 0), (0, n - 7)]:
        for i in range(7):
            for j in range(7):
                if i in (0, 6) or j in (0, 6) or (2 <= i <= 4 and 2 <= j <= 4):
                    cells.add((ox + i, oy + j))
    for x in range(n):
        for y in range(n):
            in_f = (x < 8 and y < 8) or (x >= n - 8 and y < 8) or (x < 8 and y >= n - 8)
            if not in_f and rnd.random() > 0.5:
                cells.add((x, y))
    return sorted(cells)


# ----------------------------------------------------------------- Austin bill (US)
AUSTIN = dict(
    total=142.00, kwh=864,
    lines=[("Customer charge", "32 days", 12.50),
           ("Energy charge", "864 kWh x $0.0780", 67.39),
           ("Power supply adjustment", "864 kWh x $0.0310", 26.78),
           ("Delivery charge", "864 kWh x $0.0215", 18.58),
           ("Regulatory charge", "864 kWh x $0.0028", 2.42),
           ("Community solar program", "flat", 4.00),
           ("City franchise & service fee", "", 10.33)],
)
assert abs(sum(l[2] for l in AUSTIN["lines"]) - AUSTIN["total"]) < 0.005, sum(l[2] for l in AUSTIN["lines"])


def austin_html():
    a = AUSTIN
    rows = "".join(f'<tr><td>{n}</td><td class="c">{c}</td><td class="r">${v:,.2f}</td></tr>' for n, c, v in a["lines"])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Zilker Valley Power - October 2026 statement</title>
<style>
@page {{ size: 8.5in 11in; margin: 0 }}
* {{ box-sizing: border-box; margin: 0; padding: 0 }}
html, body {{ width: 816px; height: 1056px; font-family: 'Helvetica Neue',Arial,sans-serif; color: #1c2430; font-size: 12px }}
.page {{ position: relative; width: 816px; height: 1056px; overflow: hidden; background: #fff }}
.band {{ background: #12486b; color: #fff; padding: 22px 40px; display: flex; justify-content: space-between; align-items: center }}
.band b {{ font-size: 25px; letter-spacing: .5px }}
.band small {{ display: block; font-size: 10px; opacity: .85; letter-spacing: 1px; margin-top: 3px }}
.band .r {{ text-align: right; font-size: 11px; line-height: 1.5 }}
.accent {{ height: 6px; background: linear-gradient(90deg,#2aa876,#f2b632) }}
.wrap {{ padding: 22px 40px }}
.row {{ display: flex; gap: 22px }}
.card {{ border: 1px solid #c8d0d8; padding: 12px 14px; flex: 1; line-height: 1.7 }}
.card h3 {{ font-size: 10px; letter-spacing: 1.5px; color: #5a6a7a; margin-bottom: 4px }}
.due {{ border: 3px solid #12486b; flex: 1 }}
.due .h {{ background: #12486b; color: #fff; padding: 5px 12px; font-size: 11px; letter-spacing: 1.5px }}
.due .big {{ font-size: 40px; font-weight: 700; padding: 10px 14px 2px; text-align: right }}
.due .d {{ display: flex; justify-content: space-between; padding: 8px 14px; background: #fff3d1; border-top: 1px solid #12486b }}
.due .d b {{ color: #a62b14; font-size: 15px }}
h2 {{ font-size: 13px; margin: 20px 0 6px; padding-left: 8px; border-left: 5px solid #2aa876 }}
table {{ width: 100%; border-collapse: collapse }}
th, td {{ border: 1px solid #c8d0d8; padding: 6px 10px; text-align: left; font-weight: 400 }}
th {{ background: #eef2f6; font-weight: 600 }}
td.r, th.r {{ text-align: right }} td.c {{ color: #5a6a7a; font-size: 11px }}
tr.sum td {{ background: #fff3d1; font-weight: 700; font-size: 13px }}
.usage {{ display: flex; gap: 22px }}
.usage table {{ flex: 1 }}
.note {{ font-size: 10px; color: #5a6a7a; margin-top: 8px; line-height: 1.55 }}
.cut {{ position: absolute; left: 0; right: 0; top: 836px; border-top: 2px dashed #888 }}
.cut span {{ position: absolute; left: 40px; top: -9px; background: #fff; padding: 0 8px; font-size: 10px; color: #666 }}
.stub {{ position: absolute; left: 40px; right: 40px; top: 856px; display: flex; justify-content: space-between; gap: 20px; font-size: 11px; line-height: 1.7 }}
.stub .amt {{ font-size: 22px; font-weight: 700 }}
.stub .bc {{ margin-top: 10px }}
.stamp {{ position: absolute; right: 52px; top: 132px; transform: rotate(7deg); border: 2px solid rgba(166,43,20,.55); color: rgba(166,43,20,.7); padding: 2px 8px; font-size: 11px; font-weight: 700; letter-spacing: 1px }}
.foot {{ position: absolute; bottom: 12px; left: 40px; right: 40px; text-align: center; font-size: 9.5px; color: #8a929a }}
</style></head><body><div class="page">
<div class="band"><div><b>Zilker Valley Power</b><small>FICTIONAL MUNICIPAL ELECTRIC UTILITY</small></div>
<div class="r">Residential electric statement<br>Statement date: Nov 12, 2026</div></div>
<div class="accent"></div>
<div class="wrap">
  <div class="row">
    <div class="card"><h3>CUSTOMER</h3>Maya Sample<br>100 Sample Street, Unit 0<br>Austin, TX 78700<br>
      <span style="color:#5a6a7a">Account no.</span> 000-000-4417<br><span style="color:#5a6a7a">Rate</span> Residential Standard (R-1)</div>
    <div class="due"><div class="h">AMOUNT DUE</div><div class="big">$142.00</div>
      <div class="d"><span>Pay by</span><b>Dec 3, 2026</b></div></div>
  </div>
  <h2>Billing summary</h2>
  <div class="usage">
    <table>
      <tr><th>Service period</th><td class="r"><b>Oct 10, 2026 - Nov 10, 2026</b> (32 days)</td></tr>
      <tr><th>Previous balance</th><td class="r">$0.00</td></tr>
      <tr><th>Payment received Oct 28</th><td class="r">-$131.40</td></tr>
      <tr><th>Previous bill (Sep period)</th><td class="r">$131.40</td></tr>
      <tr><th>New charges this period</th><td class="r">$142.00</td></tr>
      <tr><th>Meter reading</th><td class="r">048,215 to 049,079 = {a['kwh']} kWh</td></tr>
    </table>
  </div>
  <h2>Charge details</h2>
  <table>
    <tr><th>Description</th><th>Calculation</th><th class="r">Amount</th></tr>
    {rows}
    <tr class="sum"><td colspan="2">Total new charges - amount due</td><td class="r">${a['total']:,.2f}</td></tr>
  </table>
  <p class="note">Usage this period: {a['kwh']} kWh (about 27 kWh per day). Same period last year: 801 kWh.<br>
  Pay online at https://pay.zilkervalley-power.example, by phone at (512) 555-0100, or mail the stub below. Late payments after Dec 3 may incur a fee.</p>
</div>
<div class="cut"><span>Detach and return with payment</span></div>
<div class="stub">
  <div>Zilker Valley Power (fictional)<br>PO Box 0000, Austin, TX 78700<br>Account no. 000-000-4417<br>Statement date Nov 12, 2026</div>
  <div style="text-align:right">Amount due by Dec 3, 2026<div class="amt">$142.00</div>
  <div class="bc">{barcode_svg(250, 40, 20261112)}</div></div>
</div>
<div class="stamp">SAMPLE - FICTIONAL</div>
<div class="foot">This statement was created for a hackathon demo. All companies, people, addresses and numbers are fictional.</div>
</div></body></html>"""


# ----------------------------------------------------------------- emails
def pdf_bytes(stem):
    with open(os.path.join(OUT, stem + ".pdf"), "rb") as f:
        return f.read()


def build_eml(path, *, subject, from_, to, date, text, html, msgid_host, pdf=None, pdf_name=None, extra=None):
    m = EmailMessage(policy=policy.SMTP)
    m["From"], m["To"], m["Subject"] = from_, to, subject
    m["Date"] = format_datetime(date)
    m["Message-ID"] = make_msgid(domain=msgid_host)
    m["MIME-Version"] = "1.0"
    for k, v in (extra or {}).items():
        m[k] = v
    m.set_content(text, subtype="plain", charset="utf-8", cte="base64")
    m.add_alternative(html, subtype="html", charset="utf-8", cte="base64")
    if pdf:
        m.add_attachment(pdf, maintype="application", subtype="pdf", filename=pdf_name)
    with open(path, "wb") as f:
        f.write(m.as_bytes())


def hikari_eml():
    h = HIKARI
    breakdown_txt = "\n".join(f"  {n:<14} {c:<16} {yen(a):>7}円" if False else f"  ・{n}　{c}　{yen(a)}円".replace("　　", "　")
                              for n, c, a in h["lines"])
    fwd_head = ("---------- 転送されたメッセージ ----------\n"
                "差出人: 光電気 お客様サービス <noreply@mail.hikari-denki.example>\n"
                "日付: 2026年11月1日 7:30\n"
                "件名: 【光電気】2026年10月分 電気ご使用量・ご請求金額のお知らせ\n"
                "宛先: Ben Sample <ben.sample@mail.example>\n")
    text = f"""請求書を転送します。（Ben）

{fwd_head}
サンプル　ベン　様

いつも光電気をご利用いただき、ありがとうございます。
2026年10月分の電気料金をお知らせいたします。

■ご請求金額　　{yen(h['total'])}円（税込）
■お支払期日　　2026年11月27日（金）
■ご使用期間　　2026年9月29日〜2026年10月29日（31日間）
■ご使用量　　　{h['kwh']}kWh（前月 {h['prev_kwh']}kWh）
■前月ご請求額　{yen(h['prev'])}円
■お客様番号　　99-0000-1234（従量電灯B 40A）

【ご請求内訳（税込）】
{breakdown_txt}
  ご請求金額 合計　{yen(h['total'])}円（うち消費税等 {yen(h['tax'])}円）
※再エネ賦課金は、ご使用量 {h['kwh']}kWh × 3.49円 = 1,438円 です。

【お支払い方法】
・添付の請求書PDFに付いているコンビニ払込票で、期日までにお支払いください。
・マイページからのお支払い・口座振替への変更はこちら
  https://mypage.hikari-denki.example/bills/202610

このメールは送信専用です。ご不明点はお問い合わせ窓口（0120-000-000）まで。
光電気株式会社（架空の会社）
※このメールはハッカソンのデモ用に作成した架空のものです。
"""
    rows = "".join(f"<tr><td>{n}</td><td>{c}</td><td style='text-align:right'>{yen(a)}円</td></tr>" for n, c, a in h["lines"])
    html = f"""<!doctype html><html lang="ja"><head><meta charset="utf-8"></head>
<body style="font-family:'Hiragino Kaku Gothic ProN',Meiryo,sans-serif;color:#222;font-size:14px">
<p>請求書を転送します。（Ben）</p>
<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding-left:12px;color:#444">
<p style="font-size:12px;color:#777">---------- 転送されたメッセージ ----------<br>差出人: 光電気 お客様サービス &lt;noreply@mail.hikari-denki.example&gt;<br>日付: 2026年11月1日 7:30<br>件名: 【光電気】2026年10月分 電気ご使用量・ご請求金額のお知らせ<br>宛先: Ben Sample &lt;ben.sample@mail.example&gt;</p>
<div style="background:#f08a00;color:#fff;padding:10px 14px;font-size:18px;letter-spacing:2px">光電気　電気ご使用量のお知らせ</div>
<p>サンプル　ベン　様<br>いつも光電気をご利用いただき、ありがとうございます。2026年10月分の電気料金をお知らせいたします。</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #bbb">
<tr><th align="left" bgcolor="#f3efe6">ご請求金額</th><td><b style="font-size:20px">{yen(h['total'])}円</b>（税込）</td></tr>
<tr><th align="left" bgcolor="#f3efe6">支払期日</th><td><b>2026年11月27日（金）</b></td></tr>
<tr><th align="left" bgcolor="#f3efe6">ご使用期間</th><td>2026年9月29日〜2026年10月29日（31日間）</td></tr>
<tr><th align="left" bgcolor="#f3efe6">ご使用量</th><td>{h['kwh']}kWh（前月 {h['prev_kwh']}kWh）</td></tr>
<tr><th align="left" bgcolor="#f3efe6">前月ご請求額</th><td>{yen(h['prev'])}円</td></tr>
<tr><th align="left" bgcolor="#f3efe6">お客様番号</th><td>99-0000-1234（従量電灯B 40A）</td></tr></table>
<h4>ご請求内訳（税込）</h4>
<table cellpadding="6" border="1" style="border-collapse:collapse;border-color:#bbb">{rows}
<tr bgcolor="#fff4d6"><td colspan="2"><b>ご請求金額 合計</b></td><td style="text-align:right"><b>{yen(h['total'])}円</b></td></tr></table>
<p style="font-size:12px">うち消費税等 {yen(h['tax'])}円。再エネ賦課金は {h['kwh']}kWh × 3.49円 = 1,438円。</p>
<p>添付の請求書PDFのコンビニ払込票で、期日までにお支払いください。<br>
<a href="https://mypage.hikari-denki.example/bills/202610">マイページで請求内容を確認する</a></p>
<p style="font-size:11px;color:#777">光電気株式会社（架空の会社）／ このメールはハッカソンのデモ用に作成した架空のものです。</p>
</blockquote></body></html>"""
    build_eml(os.path.join(OUT, "hikari-denki-2026-11.eml"),
              subject="Fwd: 【光電気】2026年10月分 電気ご使用量・ご請求金額のお知らせ",
              from_="Ben Sample <ben.sample@mail.example>", to="ben.bills@in.saver.example",
              date=datetime(2026, 11, 1, 10, 5, tzinfo=JST), text=text, html=html,
              msgid_host="mail.example", pdf=pdf_bytes("hikari-denki-2026-11"),
              pdf_name="hikari-denki-2026-11.pdf")


def statement_ready_eml():
    text = """【Card A】2026年11月分 ご利用明細のお知らせ

サンプル　ベン　様

いつもCard Aをご利用いただき、ありがとうございます。
ご利用明細が確定しました。

■明細確定日　　2026年11月1日
■ご利用期間　　2026年9月16日〜2026年10月15日（締め日 10月15日）
■お支払日　　　2026年11月26日（木）
■お支払い口座　登録口座（口座振替）

ご請求額・ご利用内容の詳細は、マイページの明細ページでご確認ください。
▼ご利用明細を確認する
https://mypage.card-a.example/statements/202611?ref=notice

※セキュリティのため、このメールにはご請求額を記載しておりません。
※このメールに心当たりがない場合は、リンクを開かずに削除してください。

Card A サンプルカード株式会社（架空の会社）
お問い合わせ：0120-000-111（架空）
※このメールはハッカソンのデモ用に作成した架空のものです。
"""
    html = """<!doctype html><html lang="ja"><head><meta charset="utf-8"></head>
<body style="font-family:'Hiragino Kaku Gothic ProN',Meiryo,sans-serif;color:#222;font-size:14px;max-width:560px">
<div style="background:#5b2fa0;color:#fff;padding:12px 16px;font-size:18px;letter-spacing:1px">Card A　ご利用明細のお知らせ</div>
<p>サンプル　ベン　様</p>
<p>いつもCard Aをご利用いただき、ありがとうございます。<br><b>ご利用明細が確定しました。</b></p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #ccc">
<tr><th align="left" bgcolor="#f1ecf8">明細確定日</th><td>2026年11月1日</td></tr>
<tr><th align="left" bgcolor="#f1ecf8">ご利用期間</th><td>2026年9月16日〜2026年10月15日（締め日 10月15日）</td></tr>
<tr><th align="left" bgcolor="#f1ecf8">お支払日</th><td>2026年11月26日（木）</td></tr>
<tr><th align="left" bgcolor="#f1ecf8">お支払い口座</th><td>登録口座（口座振替）</td></tr></table>
<p>ご請求額・ご利用内容の詳細は、マイページの明細ページでご確認ください。</p>
<p><a href="https://mypage.card-a.example/statements/202611?ref=notice" style="display:inline-block;background:#5b2fa0;color:#fff;padding:10px 18px;text-decoration:none">ご利用明細を確認する</a></p>
<p style="font-size:12px;color:#666">※セキュリティのため、このメールにはご請求額を記載しておりません。<br>※このメールに心当たりがない場合は、リンクを開かずに削除してください。</p>
<p style="font-size:11px;color:#888">Card A サンプルカード株式会社（架空の会社）／ お問い合わせ 0120-000-111（架空）<br>このメールはハッカソンのデモ用に作成した架空のものです。</p>
</body></html>"""
    build_eml(os.path.join(OUT, "statement-ready-only.eml"),
              subject="【Card A】2026年11月分 ご利用明細のお知らせ",
              from_="Card A お知らせ <notice@mail.card-a.example>", to="ben.bills@in.saver.example",
              date=datetime(2026, 11, 1, 6, 0, tzinfo=JST), text=text, html=html, msgid_host="mail.card-a.example",
              extra={"X-Forwarded-For": "ben.sample@mail.example ben.bills@in.saver.example",
                     "Auto-Submitted": "auto-generated"})


def austin_eml():
    a = AUSTIN
    lines = "\n".join(f"  {n:<32}{('$%.2f' % v):>9}" for n, c, v in a["lines"])
    fwd = ("---------- Forwarded message ----------\n"
           "From: Zilker Valley Power Billing <billing@mail.zilkervalley-power.example>\n"
           "Date: Thu, Nov 12, 2026 at 8:00 AM\n"
           "Subject: Your Zilker Valley Power statement is ready - $142.00 due Dec 3\n"
           "To: Maya Sample <maya.sample@mail.example>\n")
    text = f"""Forwarding my electric bill. - Maya

{fwd}
Hi Maya,

Your October electric statement is ready.

  Amount due:      $142.00
  Pay by:          December 3, 2026
  Service period:  Oct 10, 2026 - Nov 10, 2026 (32 days)
  Usage:           {a['kwh']} kWh
  Previous bill:   $131.40 (paid Oct 28)
  Account no.:     000-000-4417  (Residential Standard R-1)

Charge details
{lines}
  {'Total amount due':<32}{'$142.00':>9}

Your statement is attached as a PDF. Pay online at
https://pay.zilkervalley-power.example/accounts/4417 or call (512) 555-0100.
Late payments after Dec 3 may incur a fee.

Zilker Valley Power (fictional utility)
This message was created for a hackathon demo. All names and numbers are fictional.
"""
    rows = "".join(f"<tr><td>{n}</td><td style='text-align:right'>${v:,.2f}</td></tr>" for n, c, v in a["lines"])
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"></head>
<body style="font-family:Helvetica,Arial,sans-serif;color:#1c2430;font-size:14px;max-width:560px">
<p>Forwarding my electric bill. - Maya</p>
<blockquote style="border-left:3px solid #ccc;margin:12px 0;padding-left:12px">
<p style="font-size:12px;color:#777">---------- Forwarded message ----------<br>From: Zilker Valley Power Billing &lt;billing@mail.zilkervalley-power.example&gt;<br>Date: Thu, Nov 12, 2026 at 8:00 AM<br>Subject: Your Zilker Valley Power statement is ready - $142.00 due Dec 3<br>To: Maya Sample &lt;maya.sample@mail.example&gt;</p>
<div style="background:#12486b;color:#fff;padding:10px 14px;font-size:18px">Zilker Valley Power</div>
<p>Hi Maya, your October electric statement is ready.</p>
<table cellpadding="6" style="border-collapse:collapse;border:1px solid #c8d0d8">
<tr><th align="left" bgcolor="#eef2f6">Amount due</th><td><b style="font-size:20px">$142.00</b></td></tr>
<tr><th align="left" bgcolor="#eef2f6">Pay by</th><td><b>December 3, 2026</b></td></tr>
<tr><th align="left" bgcolor="#eef2f6">Service period</th><td>Oct 10, 2026 - Nov 10, 2026 (32 days)</td></tr>
<tr><th align="left" bgcolor="#eef2f6">Usage</th><td>{a['kwh']} kWh</td></tr>
<tr><th align="left" bgcolor="#eef2f6">Previous bill</th><td>$131.40 (paid Oct 28)</td></tr>
<tr><th align="left" bgcolor="#eef2f6">Account no.</th><td>000-000-4417 (Residential Standard R-1)</td></tr></table>
<h4>Charge details</h4><table cellpadding="5" border="1" style="border-collapse:collapse;border-color:#c8d0d8">{rows}
<tr bgcolor="#fff3d1"><td><b>Total amount due</b></td><td style="text-align:right"><b>$142.00</b></td></tr></table>
<p>Your statement is attached as a PDF. <a href="https://pay.zilkervalley-power.example/accounts/4417">Pay online</a> or call (512) 555-0100. Late payments after Dec 3 may incur a fee.</p>
<p style="font-size:11px;color:#888">Zilker Valley Power (fictional utility). This message was created for a hackathon demo. All names and numbers are fictional.</p>
</blockquote></body></html>"""
    build_eml(os.path.join(OUT, "austin-power-2026-11.eml"),
              subject="Fwd: Your Zilker Valley Power statement is ready - $142.00 due Dec 3",
              from_="Maya Sample <maya.sample@mail.example>", to="maya.bills@in.saver.example",
              date=datetime(2026, 11, 14, 9, 20, tzinfo=CST), text=text, html=html, msgid_host="mail.example",
              pdf=pdf_bytes("austin-power-2026-11"), pdf_name="austin-power-2026-11.pdf")


# ----------------------------------------------------------------- main
if __name__ == "__main__":
    if not os.path.exists(CHROME):
        sys.exit(f"Chrome not found at {CHROME}; set CHROME=/path/to/chrome")
    render(hikari_html(), "hikari-denki-2026-11", 794, 1123)
    render(kokuho_html(), "kokuho-2026-nouhusho", 794, 470)
    render(austin_html(), "austin-power-2026-11", 816, 1056, png=False)
    hikari_eml()
    statement_ready_eml()
    austin_eml()
    print("done:", ", ".join(sorted(f for f in os.listdir(OUT) if not f.startswith("_") and f != "html")))
