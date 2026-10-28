#!/usr/bin/env python3
"""生成 MineDeck 内嵌字体：Geist / Geist Mono（西文、等宽）+ Noto Sans SC（中文）的 WOFF2 子集。

用法（在仓库根目录）：
    python -m pip install -r tools/fonts/requirements.txt
    python tools/fonts/build_fonts.py            # 下载源文件（有缓存）→ 校验 → 子集化 → 写入 internal/web/ui/fonts/
    python tools/fonts/build_fonts.py --check    # 只检查：产物是否与当前源文件、字符集一致（不写文件）

产物（全部入库，运行时由 go:embed 打包，零外部请求）：
    internal/web/ui/fonts/Geist-latin.woff2        Geist（可变字重 400–600），西文子集
    internal/web/ui/fonts/GeistMono-latin.woff2    Geist Mono（可变字重 400–600），西文子集
    internal/web/ui/fonts/NotoSansSC-gb2312.woff2  Noto Sans SC（可变字重 400–600），GB2312 全集 + 界面用字
    internal/web/ui/fonts/fonts.css                上面三个字体的 @font-face（unicode-range 按实际字形表生成）
    internal/web/ui/fonts/OFL-Geist.txt、OFL-NotoSansSC.txt   SIL OFL 1.1 许可原文（随字体分发必须附带）

字体来源与字符集的构成见同目录的 README.md。生成结果是确定的：同样的源文件、同样的界面文案、
同样版本的 fonttools / brotli，产物逐字节相同（不改写字体内的时间戳）。
"""
import argparse
import base64
import hashlib
import io
import os
import sys
import tarfile
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
UI = os.path.join(ROOT, "internal", "web", "ui")
OUT = os.path.join(UI, "fonts")
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")

# ---------------- 源文件（固定版本 + 校验和） ----------------
# Geist / Geist Mono：Vercel 官方 npm 包 geist@1.8.2（字体版本 1.802），取包内的可变字重 TTF 与许可原文。
GEIST_NPM = {
    "url": "https://registry.npmjs.org/geist/-/geist-1.8.2.tgz",
    "integrity": "sha512-fRF4sbJ9qcCxPb35cVtKBAwYlTt1IbU9nkbPi0a+xyZqPIjCJ2BY8ekGhx6/SGSZKrR7/UuL57r/eeDQ1Xy11g==",
    "members": {
        "package/dist/fonts/geist-sans/Geist-Variable.ttf": "98c7f53f48cb74b8b89e012e3902f0c11d12ae361c67db8da35d5969cfaa610d",
        "package/dist/fonts/geist-mono/GeistMono-Variable.ttf": "4d2bad39b04d4e994500de6d2a70d2a74beb61de24cd127394294258f55e8c7f",
        "package/LICENSE.txt": None,
    },
}
# Noto Sans SC：Google Fonts 官方仓库 google/fonts 固定提交里的可变字重 TTF（与上游 notofonts/noto-cjk 同源）。
GF_COMMIT = "ddf386ba1b9fbc6b2c818f1ddcd9148f54ced94b"
NOTO_FILES = {
    "NotoSansSC[wght].ttf": ("ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf",
                             "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"),
    "NotoSansSC-OFL.txt": ("ofl/notosanssc/OFL.txt",
                           "1c05c68c34f9708415aada51f17e1b0092d2cea709bf4a94cd38114f9e73d7d9"),
}

WGHT = (400, 600)  # 界面只用 400 / 500 / 600 三档：可变字重轴限制到这一段，省体积

# ---------------- 字符集 ----------------
def gb2312(row_from, row_to):
    """按 GB2312 区位表（区 row_from..row_to）推导字符，无需外部字表。1–9 区为符号，16–55 区一级汉字，56–87 区二级汉字。"""
    out = []
    for hi in range(0xA0 + row_from, 0xA0 + row_to + 1):
        for lo in range(0xA1, 0xFF):
            try:
                out.append(bytes([hi, lo]).decode("gb2312"))
            except UnicodeDecodeError:
                pass
    return out


# 常用中文标点与符号（GB2312 符号区之外、或 Python 的 gb2312 映射与 GBK / 微软映射不同的那几个，如 · — ―）
PUNCT = ("、。〈〉《》「」『』【】〔〕〖〗〝〞〃々〆〇・～！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝￥"
         "“”‘’…—―–·•※★☆○●◎◇◆□■△▲→←↑↓①②③④⑤⑥⑦⑧⑨⑩")

# 西文子集：Google Fonts「latin」范围 + 箭头、≤ ≥ 等常用符号、控制台用的制表符与方块元素。
# 中文语境的破折号、弯引号、省略号（U+2014、U+2018–201F、U+2026）刻意不放进西文字体，交给中文字体渲染成全角样式。
CJK_STYLE_PUNCT = {0x2014, 0x2018, 0x2019, 0x201A, 0x201B, 0x201C, 0x201D, 0x201E, 0x201F, 0x2026}
LATIN = (list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
         + [0x131, 0x152, 0x153, 0x2BB, 0x2BC, 0x2C6, 0x2DA, 0x2DC, 0x304, 0x308, 0x329]
         + [u for u in range(0x2000, 0x2070) if u not in CJK_STYLE_PUNCT]
         + [0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x21B5, 0x21E7, 0x2212, 0x2215, 0x221E, 0x2248,
            0x2260, 0x2264, 0x2265, 0x2318, 0x2325, 0x2713, 0x2717, 0xFEFF, 0xFFFD]
         + list(range(0x2500, 0x25A0)))

UI_EXT = (".js", ".html", ".css")


def ui_chars():
    """界面文案用到的全部非 ASCII 字符（扫描 internal/web/ui 下的 js / html / css，fonts/ 目录除外）。"""
    chars = set()
    for name in sorted(os.listdir(UI)):
        p = os.path.join(UI, name)
        if os.path.isfile(p) and name.endswith(UI_EXT):
            with open(p, encoding="utf-8") as f:
                chars |= {c for c in f.read() if ord(c) > 0x7E}
    return chars


def cjk_charset():
    han = gb2312(16, 87)          # GB2312 全部 6763 个汉字（一级 3755 + 二级 3008）
    sym = gb2312(1, 9)            # GB2312 符号区 682 个：标点、全角字符、序号、假名、希腊 / 俄文字母、拼音、制表符
    ui = ui_chars()
    cs = set(han) | set(sym) | set(PUNCT) | ui
    cs = {c for c in cs if ord(c) > 0x7E}  # ASCII 交给 Geist；中文子集不带 ASCII
    extra = sorted(c for c in ui if c not in set(han) | set(sym))
    return cs, len(han), len(sym), extra


# ---------------- 下载与校验 ----------------
def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "minedeck-font-build"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def cached(name, url, check):
    """读缓存，没有就下载；check(bytes) 不通过则报错退出（不使用来路不明的文件）。"""
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, name)
    if os.path.exists(p):
        with open(p, "rb") as f:
            data = f.read()
        if check(data):
            return data
        print(f"缓存的 {name} 校验不符，重新下载", flush=True)
    print(f"下载 {url}", flush=True)
    data = fetch(url)
    if not check(data):
        sys.exit(f"校验失败：{url}")
    with open(p, "wb") as f:
        f.write(data)
    return data


def sources():
    algo, want = GEIST_NPM["integrity"].split("-", 1)
    tgz = cached("geist-1.8.2.tgz", GEIST_NPM["url"],
                 lambda b: base64.b64encode(hashlib.new(algo, b).digest()).decode() == want)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(tgz), mode="r:gz") as t:
        for member, digest in GEIST_NPM["members"].items():
            data = t.extractfile(member).read()
            if digest and sha256(data) != digest:
                sys.exit(f"npm 包内 {member} 的 SHA-256 不符")
            files[os.path.basename(member)] = data
    for name, (path, digest) in NOTO_FILES.items():
        url = f"https://raw.githubusercontent.com/google/fonts/{GF_COMMIT}/{path}"
        files[name] = cached(name, url, lambda b, d=digest: sha256(b) == d)
    return files


# ---------------- 子集化 ----------------
def make_subset(ttf_bytes, unicodes, hinting):
    font = TTFont(io.BytesIO(ttf_bytes), recalcTimestamp=False)
    o = subset.Options()
    o.layout_features = ["*"]                                            # 保留全部 OpenType 特性（tnum 等宽数字等）
    o.name_IDs = ["*"]; o.name_legacy = True; o.name_languages = ["*"]   # 保留版权（0）、许可（13）、许可链接（14）
    o.notdef_outline = True
    o.hinting = hinting
    o.drop_tables += ["meta"]
    s = subset.Subsetter(o)
    s.populate(unicodes=sorted(unicodes))
    s.subset(font)
    # 先子集化、再限制字重轴（反过来做 fontTools 会在 gvar 上出错，且更慢）
    buf = io.BytesIO(); font.save(buf); buf.seek(0)
    font = TTFont(buf, recalcTimestamp=False)
    font = instancer.instantiateVariableFont(font, {"wght": WGHT})
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue(), set(font.getBestCmap())


def urange(cps):
    cps = sorted(set(cps)); out = []; i = 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append("U+%04X" % cps[i] if i == j else "U+%04X-%04X" % (cps[i], cps[j]))
        i = j + 1
    return ", ".join(out)


def font_face(family, file, cmap=None):
    rng = f"\n  unicode-range: {urange(cmap)};" if cmap else ""
    return (f'@font-face {{\n  font-family: "{family}";\n  src: url("{file}") format("woff2");\n'
            f"  font-weight: {WGHT[0]} {WGHT[1]};\n  font-style: normal;\n  font-display: block;{rng}\n}}\n")


def build():
    files = sources()
    cjk, n_han, n_sym, extra = cjk_charset()
    jobs = [
        ("Geist-latin.woff2", files["Geist-Variable.ttf"], set(LATIN), True),
        ("GeistMono-latin.woff2", files["GeistMono-Variable.ttf"], set(LATIN), True),
        ("NotoSansSC-gb2312.woff2", files["NotoSansSC[wght].ttf"], {ord(c) for c in cjk}, False),
    ]
    out, cmaps = {}, {}
    for name, src, unicodes, hinting in jobs:
        print(f"子集化 {name}（{len(unicodes)} 个码位）……", flush=True)
        out[name], cmaps[name] = make_subset(src, unicodes, hinting)
    css = ("/* 由 tools/fonts/build_fonts.py 生成，请勿手改。字体：SIL OFL 1.1，许可原文见同目录 OFL-*.txt。\n"
           "   西文、等宽字体带 unicode-range（按子集实际字形表生成）：中文与全角标点落到 Noto Sans SC，\n"
           "   子集之外的生僻字由字体栈后面的系统字体（微软雅黑等）补上。 */\n"
           + font_face("MD Geist", "Geist-latin.woff2", cmaps["Geist-latin.woff2"])
           + font_face("MD Geist Mono", "GeistMono-latin.woff2", cmaps["GeistMono-latin.woff2"])
           + font_face("MD Noto Sans SC", "NotoSansSC-gb2312.woff2"))
    out["fonts.css"] = css.encode("utf-8")
    out["OFL-Geist.txt"] = files["LICENSE.txt"]
    out["OFL-NotoSansSC.txt"] = files["NotoSansSC-OFL.txt"]
    report = {
        "GB2312 汉字": n_han, "GB2312 符号区": n_sym, "中文子集字符数": len(cjk),
        "界面用字中 GB2312 以外的字符": "".join(extra) or "（无）",
    }
    return out, report


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="只比对现有产物，不写文件；不一致时退出码为 1")
    args = ap.parse_args()
    out, report = build()
    for k, v in report.items():
        print(f"{k}：{v}")
    changed = []
    for name, data in out.items():
        p = os.path.join(OUT, name)
        old = open(p, "rb").read() if os.path.exists(p) else None
        if old != data:
            changed.append(name)
        print(f"  {name:28s} {len(data) / 1024:8.1f} KB{'' if old == data else '  （有变化）'}")
    total = sum(len(out[n]) for n in out if n.endswith(".woff2"))
    print(f"三个 WOFF2 合计 {total / 1024:.0f} KB")
    if args.check:
        if changed:
            print("产物与当前源文件 / 界面用字不一致：" + "、".join(changed) + "。请运行 python tools/fonts/build_fonts.py 重新生成。")
            sys.exit(1)
        print("产物与源文件、界面用字一致。")
        return
    os.makedirs(OUT, exist_ok=True)
    for name, data in out.items():
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(data)
    print(f"已写入 {os.path.relpath(OUT, ROOT)}" + ("（无变化）" if not changed else ""))


if __name__ == "__main__":
    main()
