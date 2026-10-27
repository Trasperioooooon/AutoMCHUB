// qrcode.js — 精简 QR 码编码器（纯前端、零依赖、离线可用；随 go:embed 打进单文件 exe）
// 按 ISO/IEC 18004 实现 Model 2：字节模式（UTF-8）+ 纠错等级 M，版本 1–40 自动取最小，
// 8 种掩码按四条罚分规则择优。算法结构参考 Project Nayuki「QR Code generator library」（MIT）。
// 只为把局域网访问地址画成二维码：不做数字/字母数字模式、ECI 与其它纠错等级。
// 用法：QR.encode(text) → { version, mask, size, modules[y][x] }；QR.svg(text) → SVG 字符串（自带 4 模块静区）。
"use strict";
window.QR = (function () {
  // 纠错等级 M：各版本（下标 = 版本号，0 占位）每块纠错码字数 / 纠错块数
  const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
  ];

  // 版本 v 可放数据与纠错码字的模块数（总面积扣除定位/定时/校正图形与格式、版本信息）
  function rawModules(v) {
    let n = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const a = Math.floor(v / 7) + 2;
      n -= (25 * a - 10) * a - 55;
      if (v >= 7) n -= 36;
    }
    return n;
  }
  const dataCodewords = v => Math.floor(rawModules(v) / 8) - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];

  // 校正图形中心坐标（行列共用）
  function alignPositions(v) {
    if (v === 1) return [];
    const n = Math.floor(v / 7) + 2;
    const step = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
    const r = [6];
    for (let pos = v * 4 + 10; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  // GF(2^8) 乘法（本原多项式 x^8+x^4+x^3+x^2+1 = 0x11D）
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  // Reed–Solomon 生成多项式系数（degree 阶，省略首项 1，高次在前）
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    for (let i = 0, root = 1; i < degree; i++, root = gfMul(root, 2)) {
      for (let j = 0; j < degree; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
    }
    return r;
  }
  function rsRemainder(data, div) {
    const r = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ r.shift();
      r.push(0);
      div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
    }
    return r;
  }

  // 罚分（越低越易识读）：①行列连续同色 ≥5 ②2×2 同色块 ③类定位图形 1:1:3:1:1 一侧接 4 浅（界外按静区算浅）④深色占比偏离 50%
  function penalty(m, size) {
    let p = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let a = 0; a < size; a++) {
        const line = [];
        for (let b = 0; b < size; b++) line.push(pass ? m[b][a] : m[a][b]);
        for (let b = 0, run = 0; b <= size; b++) {
          if (b < size && b > 0 && line[b] === line[b - 1]) { run++; continue; }
          if (run >= 5) p += run - 2;
          run = 1;
        }
        const light = i => i < 0 || i >= size || !line[i];
        for (let b = 0; b + 7 <= size; b++) {
          if (line[b] && !line[b + 1] && line[b + 2] && line[b + 3] && line[b + 4] && !line[b + 5] && line[b + 6] &&
            ((light(b - 1) && light(b - 2) && light(b - 3) && light(b - 4)) ||
             (light(b + 7) && light(b + 8) && light(b + 9) && light(b + 10)))) p += 40;
        }
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
      }
    }
    const total = size * size; // size 为奇数，深色占比不可能恰为 50%，故 k ≥ 0
    return p + (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  }

  function encode(text) {
    const bytes = new TextEncoder().encode(String(text));
    let ver = 1;
    while (ver <= 40 && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
    if (ver > 40) throw new Error("内容过长，无法生成二维码");

    // 位流：模式 0100 + 字节数 + 数据，再补终止符、对齐到字节、交替填充 0xEC/0x11
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    const cap = dataCodewords(ver) * 8;
    put(0b0100, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((b, bit) => (b << 1) | bit, 0));

    // 分块算纠错码（前 nShort 块比其余块少一个数据码字），再按列交织
    const nb = NUM_BLOCKS[ver], ecLen = ECC_PER_BLOCK[ver];
    const raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen - ecLen + (i < nShort ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      blocks.push({ dat, ecc: rsRemainder(dat, div) });
    }
    const words = [];
    for (let j = 0; j <= shortLen - ecLen; j++) blocks.forEach(b => { if (j < b.dat.length) words.push(b.dat[j]); });
    for (let j = 0; j < ecLen; j++) blocks.forEach(b => words.push(b.ecc[j]));

    // 功能图形：定时 → 定位（含分隔白边，覆盖定时交叠处）→ 校正 → 格式信息占位 → 版本信息（v≥7）
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { mod[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4);
        }
      }
    });
    const al = alignPositions(ver), last = al.length - 1;
    al.forEach((cy, i) => al.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return; // 与定位图形重叠的三角不画
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));
    const drawFormat = mask => { // 15 位：等级 M（00）+ 掩码号，BCH(15,5) 后异或 0x5412，两份副本 + 恒深模块
      let rem = mask;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((mask << 10) | rem) ^ 0x5412, bit = i => ((f >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(i));
      setFn(8, 7, bit(6)); setFn(8, 8, bit(7)); setFn(7, 8, bit(8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) { // 18 位版本信息：BCH(18,6)，左下与右上各一份
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((v >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
        setFn(a, b, dark); setFn(b, a, dark);
      }
    }

    // 数据区：自右下起两列一组之字形上下穿行（跳过第 6 列定时图形），剩余位留浅色
    for (let right = size - 1, i = 0; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const up = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j, y = up ? size - 1 - vert : vert;
          if (!fn[y][x] && i < words.length * 8) { mod[y][x] = ((words[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
        }
      }
    }

    // 掩码择优：逐个试（异或两次即撤销），取罚分最低者
    const applyMask = k => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) mod[y][x] = !mod[y][x];
    };
    let best = 0, bestScore = Infinity;
    for (let k = 0; k < 8; k++) {
      applyMask(k); drawFormat(k);
      const s = penalty(mod, size);
      if (s < bestScore) { best = k; bestScore = s; }
      applyMask(k);
    }
    applyMask(best); drawFormat(best);
    return { version: ver, mask: best, size, modules: mod };
  }

  // SVG：深色模块按行合并为矩形路径；四周 4 模块静区；crispEdges 防相邻模块间出现发丝缝。
  // 填色默认黑/白，页面经 .qr-bg / .qr-fg 类覆盖为恒定的 --qr-light / --qr-dark（不随主题反色）。
  function svg(text) {
    const q = encode(text), n = q.size + 8;
    let d = "";
    q.modules.forEach((row, y) => {
      for (let x = 0; x < q.size; x++) {
        if (!row[x]) continue;
        let w = 1;
        while (x + w < q.size && row[x + w]) w++;
        d += `M${x + 4} ${y + 4}h${w}v1h-${w}z`;
        x += w - 1;
      }
    });
    return `<svg class="qr" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" aria-hidden="true">` +
      `<path class="qr-bg" fill="#fff" d="M0 0h${n}v${n}H0z"/><path class="qr-fg" fill="#000" d="${d}"/></svg>`;
  }

  return { encode, svg };
})();
