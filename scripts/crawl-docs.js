/*
 * 996M2 传世脚本文档爬取器
 * 数据源: ShowDoc API (cshelp.996m2.com, item_id=17)
 * 产出: src/data/{commands,checkCommands,sysVariables,uiComponents,triggers}.json
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'docs_raw');
const PAGES_DIR = path.join(RAW, 'pages');
const OUT_DIR = path.join(ROOT, 'src', 'data');
const DOC_LINK = (id) => `http://cshelp.996m2.com/web/#/17/${id}`;

// 目标分类: 顶层 catId -> 用途
const TARGET_CATS = {
  205: 'action',   // 脚本命令专题
  233: 'check',    // 检测命令专题
  202: 'vars',     // 服务端变量专题
  206: 'action',   // 系统功能专题(大量脚本命令)
  204: 'ui',       // 自定义界面专题(UI组件)
};

// 手工补充/修正: 检测命令(在 #IF 中使用)
const MANUAL_CHECK = [
  'TRUE', 'FALSE', 'RANDOM', 'CHECK', 'EQUAL', 'LARGE', 'SMALL', 'BETWEEN',
  'CHECKVAR', 'CHECKVALIDPARAM', 'CHECKCUSTOMVALUE', 'ISNULL', 'LEVEL', 'GENDER',
];
// 检测命令前缀特征(CANCEL 除外)
const CHECK_PREFIX = /^(CHECK|IS|HAS|HAVE|CAN(?!CEL))/i;
// 手工补充: 常用但可能解析不到的执行命令
const MANUAL_ACTION = [
  { name: 'PARAM1', signature: 'PARAM1 值', desc: '配合其他命令传递参数(第1位)' },
  { name: 'PARAM2', signature: 'PARAM2 值', desc: '配合其他命令传递参数(第2位)' },
  { name: 'PARAM3', signature: 'PARAM3 值', desc: '配合其他命令传递参数(第3位)' },
  { name: 'PARAM4', signature: 'PARAM4 值', desc: '配合其他命令传递参数(第4位)' },
];
// 参数名噪音(检测页参数表被误当成命令): 仅在无参数签名时剔除
const PARAM_NOISE = new Set([
  'ITEMNAME', 'PLAYERNAME', 'GUILDNAME', 'POSITION', 'STATUS',
  'LISTFILENAME', 'GOLDCOUNT', 'COUNT', 'DISTANCE', 'CHECKTYPE', 'MONNAME', 'MAPNAME',
]);
// 投票平局时的手工归类
const KIND_OVERRIDES = { MAP: 'action' };
const STOP_WORDS = new Set([
  'NPC', 'GM', 'PC', 'EXE', 'TXT', 'URL', 'QQ', 'ID', 'ALL', 'SELF', 'NULL',
  'NONE', 'USER', 'NAME', 'VALUE', 'TYPE', 'DATA', 'FILE', 'PATH', 'TEXT',
  'TODO', 'NOTE', 'PS', 'VS', 'UI', 'HP', 'MP', 'AC', 'DC', 'MC', 'SC',
]);

function fetchPage(pageId) {
  return new Promise((resolve, reject) => {
    const body = `page_id=${pageId}`;
    const req = http.request({
      host: 'cshelp.996m2.com',
      path: '/server/index.php?s=/api/page/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (j.error_code !== 0) return reject(new Error(`page ${pageId}: ${j.error_message}`));
          resolve(j.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

function stripHtml(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#124;/g, '|')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/<\$/g, '')                    // 保护 <$ 变量写法不被当作标签
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(//g, '<$')
    .replace(/\s+/g, ' ')
    .trim();
}

// 收集目标分类下的所有页面
function collectPages() {
  const menu = JSON.parse(fs.readFileSync(path.join(RAW, 'menu.json'), 'utf8')).data.menu;
  const pages = []; // {pageId, title, kind}
  function walk(cat, inheritedKind) {
    const kind = TARGET_CATS[cat.cat_id] || inheritedKind;
    if (kind) {
      for (const p of cat.pages || []) pages.push({ pageId: p.page_id, title: p.page_title, kind });
    }
    for (const c of cat.catalogs || []) walk(c, kind);
  }
  for (const c of menu.catalogs || []) walk(c, null);
  // 去重
  const seen = new Set();
  return pages.filter((p) => (seen.has(p.pageId) ? false : (seen.add(p.pageId), true)));
}

// 从 Markdown 表格提取命令行
function parseCommandTables(md) {
  const rows = [];
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|') || !t.endsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue; // 分隔行
    const cells = t.slice(1, -1).split('|').map((c) => stripHtml(c));
    if (cells.length < 1) continue;
    rows.push(cells);
  }
  return rows;
}

const CMD_RE = /^[A-Za-z][A-Za-z0-9_]{1,29}$/;

function sigToCommand(sigCell) {
  let sig = sigCell.trim();
  // "| 脚本命令: SetStrValue | 是否可省略 | ... |" 表头格式: 取冒号后的命令名
  const hdr = sig.match(/^(?:脚本)?命令\s*[:：]\s*([A-Za-z][A-Za-z0-9_]{1,29})\s*$/);
  if (hdr) sig = hdr[1];
  const name = sig.split(/\s/)[0] || '';
  if (!CMD_RE.test(name)) return null;
  if (STOP_WORDS.has(name.toUpperCase())) return null;
  return { name, signature: sig };
}

// 提取 **CMD A B** 粗体签名
function parseBoldSignatures(md) {
  const out = [];
  const lines = md.split(/\r?\n/);
  let lastHeader = '';
  for (const line of lines) {
    const h = line.match(/^#{2,5}\s*(.+)$/);
    if (h) { lastHeader = stripHtml(h[1]); continue; }
    const b = line.match(/^\s*\*\*\s*([A-Za-z][A-Za-z0-9_]*(?:\s+[^*]{0,60})?)\s*\*\*\s*$/);
    if (b) {
      const sig = stripHtml(b[1]).replace(/\*/g, ' ').replace(/\s+/g, ' ').trim();
      const name = sig.split(/\s/)[0];
      if (CMD_RE.test(name) && !STOP_WORDS.has(name.toUpperCase())) {
        out.push({ name, signature: sig, desc: lastHeader });
      }
    }
  }
  return out;
}

// 提取标题签名: "### SetStrValue命令，..." / "### QueryMsg 弹出选择框"
function parseHeaderSignatures(md) {
  const out = [];
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^#{2,5}\s*(.+)$/);
    if (!h) continue;
    const txt = stripHtml(h[1]);
    const m = txt.match(/^([A-Za-z][A-Za-z0-9_]{1,29})(?=\s|命令|功能|，|,|：|:|\(|（|$)/);
    if (!m) continue;
    if (STOP_WORDS.has(m[1].toUpperCase())) continue;
    out.push({ name: m[1], signature: m[1], desc: txt.slice(0, 120) });
  }
  return out;
}

// 提取系统变量 <$XXX>
function parseSysVariables(md, pageId, title) {
  const out = [];
  const lines = md.split(/\r?\n/);
  // 兼容全部形态: <$NAME> / <$NAME(A)> / <$NAME[A].B> / <$NAME(A).B> / <$NAME.A>
  const varRe = /<\$([A-Za-z][A-Za-z0-9_]{0,39})((?:\([^>]{0,60}\)|\[[^\]]{0,60}\])?(?:\.[A-Za-z0-9_$.]{0,40})?)>/g;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(t)) continue;
    const cells = t.slice(1, -1).split('|').map((c) => stripHtml(c));
    const joined = cells.join(' ');
    let m;
    varRe.lastIndex = 0;
    while ((m = varRe.exec(joined))) {
      const name = m[1];
      // 排除取值函数(有专用补全/高亮处理)
      if (['STR', 'HUMAN', 'GUILD', 'GLOBAL', 'PARAM'].includes(name.toUpperCase())) continue;
      const form = name + (m[2] || '');
      const desc = cells.filter((c) => !c.includes(`<$${name}`)).join(' ').replace(/^[-\s]+$/, '');
      out.push({ name, form, desc: desc || title, docUrl: DOC_LINK(pageId) });
    }
  }
  return out;
}

// 提取触发器 [@XXX] / @XXX
function parseTriggers(md, pageId, title) {
  const out = new Map();
  const re = /\[@([A-Za-z_][A-Za-z0-9_\-一-鿿]{0,39})\]/g;
  let m;
  while ((m = re.exec(md))) {
    const name = m[1];
    if (!out.has(name)) out.set(name, { name, desc: title, docUrl: DOC_LINK(pageId) });
  }
  return [...out.values()];
}

// 提取 UI 组件 <Name|...>
function parseUiComponents(md, pageId, title) {
  // 原始 Markdown 中 < > | 多为 HTML 实体, 先解码再匹配
  const text = md.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#124;/g, '|').replace(/&quot;/g, '"');
  const comps = new Map();
  const re = /<([A-Z][A-Za-z0-9]{1,19})\|/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    if (['HTML', 'XML'].includes(name)) continue;
    if (!comps.has(name)) comps.set(name, { name, params: [], docUrl: DOC_LINK(pageId), desc: title });
  }
  // 参数表: |参数|释义| 形式的表格, 归属本页主组件
  const mainComp = comps.keys().next().value;
  if (mainComp) {
    const rows = parseCommandTables(md);
    for (const cells of rows) {
      if (cells.length < 2) continue;
      const pname = cells[0].trim();
      if (!/^[a-z_][A-Za-z0-9_]{0,24}$/.test(pname)) continue;
      if (['参数', '释义', '说明'].includes(pname)) continue;
      const pdesc = cells.slice(1).join(' ').trim();
      if (!pdesc || /^[-:：\s]+$/.test(pdesc)) continue;
      const comp = comps.get(mainComp);
      if (!comp.params.some((p) => p.name === pname)) {
        comp.params.push({ name: pname, desc: pdesc.slice(0, 120) });
      }
    }
  }
  return [...comps.values()];
}

async function main() {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const pages = collectPages();
  console.log(`目标页面数: ${pages.length}`);

  // 抓取(带缓存)
  for (const p of pages) {
    const cache = path.join(PAGES_DIR, `${p.pageId}.md`);
    if (fs.existsSync(cache)) continue;
    try {
      const data = await fetchPage(p.pageId);
      fs.writeFileSync(cache, data.page_content, 'utf8');
      process.stdout.write(`\r已抓取 ${p.pageId} ${data.page_title}   `);
      await new Promise((r) => setTimeout(r, 120)); // 限速
    } catch (e) {
      console.error(`\n抓取失败 ${p.pageId}: ${e.message}`);
    }
  }
  console.log('\n抓取完成, 开始解析...');

  const commands = new Map();   // key: NAME(大写)
  const sysVars = new Map();
  const triggers = new Map();
  const uiComps = new Map();

  const addCommand = (entry, kind, pageId, title) => {
    const key = entry.name.toUpperCase();
    // 参数名噪音: 无参数签名且命中噪音表则丢弃
    if (PARAM_NOISE.has(key) && entry.signature.trim().toUpperCase() === key) return;
    const old = commands.get(key);
    const checkVotes = (old ? old.checkVotes : 0) + (kind === 'check' ? 1 : 0);
    const actionVotes = (old ? old.actionVotes : 0) + (kind === 'action' ? 1 : 0);
    const item = {
      name: entry.name,
      signature: entry.signature,
      desc: (entry.desc || title || '').slice(0, 300),
      checkVotes,
      actionVotes,
      kind: 'action', // 最终统一判定
      docUrl: DOC_LINK(pageId),
    };
    if (!old || item.desc.length > old.desc.length + 10
        || (kind === 'check' && !old.fromCheck && item.desc.length >= old.desc.length * 0.5)) {
      // 裸名签名不覆盖已有的带参签名
      const bareNew = item.signature.trim().toUpperCase() === key;
      const bareOld = old ? old.signature.trim().toUpperCase() === key : true;
      if (old && bareNew && !bareOld) item.signature = old.signature;
      item.checkVotes = checkVotes; item.actionVotes = actionVotes;
      item.fromCheck = kind === 'check';
      commands.set(key, item);
    } else {
      old.checkVotes = checkVotes; old.actionVotes = actionVotes;
      if (kind === 'check') old.fromCheck = true;
    }
  };

  // 投票 + 手工表决定最终 kind
  const finalizeKind = () => {
    for (const [key, c] of commands) {
      let kind;
      if (KIND_OVERRIDES[key]) kind = KIND_OVERRIDES[key];
      else if (MANUAL_CHECK.includes(key)) kind = 'check';
      else if (CHECK_PREFIX.test(key)) kind = 'check';
      else if (c.checkVotes > 0 && c.actionVotes === 0) kind = 'check';
      else if (c.checkVotes > c.actionVotes) kind = 'check';
      else kind = 'action';
      c.kind = kind;
      delete c.checkVotes; delete c.actionVotes; delete c.fromCheck;
    }
  };

  for (const p of pages) {
    const cache = path.join(PAGES_DIR, `${p.pageId}.md`);
    if (!fs.existsSync(cache)) continue;
    const md = fs.readFileSync(cache, 'utf8');

    if (p.kind === 'action' || p.kind === 'check') {
      // 表格行: 第一列是命令签名
      for (const cells of parseCommandTables(md)) {
        const c = sigToCommand(cells[0]);
        if (!c) continue;
        let desc = cells.slice(1).filter(Boolean).join(' | ');
        if (/是否可省略|值范围/.test(desc)) desc = ''; // 表头噪音, 回退用页面标题
        addCommand({ name: c.name, signature: c.signature, desc }, p.kind, p.pageId, p.title);
      }
      // 粗体签名
      for (const b of parseBoldSignatures(md)) {
        addCommand(b, p.kind, p.pageId, p.title);
      }
      // 标题签名( "### XX命令..." )
      for (const h of parseHeaderSignatures(md)) {
        addCommand(h, p.kind, p.pageId, p.title);
      }
      // 触发器(仅从引擎触发页收集)
      if (['858', '966', '742', '743', '737', '738', '797', '760', '723', '1430', '1498', '1542'].includes(String(p.pageId))) {
        for (const t of parseTriggers(md, p.pageId, p.title)) {
          if (!triggers.has(t.name)) triggers.set(t.name, t);
        }
      }
    }
    if (p.kind === 'vars' || p.kind === 'action' || p.kind === 'check') {
      for (const v of parseSysVariables(md, p.pageId, p.title)) {
        const key = v.name.toUpperCase();
        if (v.form === v.name) delete v.form; // 无参数形态不存 form
        const old = sysVars.get(key);
        // 优先保留: 带参数形态 > 描述更长
        const score = (x) => x.desc.length + (x.form ? 50 : 0);
        if (!old || score(v) > score(old)) sysVars.set(key, v);
      }
    }
    if (p.kind === 'ui') {
      for (const c of parseUiComponents(md, p.pageId, p.title)) {
        const old = uiComps.get(c.name);
        if (!old || c.params.length > old.params.length) uiComps.set(c.name, c);
      }
    }
  }

  // 手工补充
  for (const a of MANUAL_ACTION) {
    const key = a.name.toUpperCase();
    if (!commands.has(key)) commands.set(key, { ...a, kind: 'action', docUrl: DOC_LINK(962) });
  }

  finalizeKind();

  // 拆分 check / action
  const checkCommands = [];
  const actionCommands = [];
  for (const c of commands.values()) {
    (c.kind === 'check' ? checkCommands : actionCommands).push(c);
  }
  const byName = (a, b) => a.name.toUpperCase().localeCompare(b.name.toUpperCase());
  actionCommands.sort(byName);
  checkCommands.sort(byName);

  const write = (file, data) => {
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(data, null, 2), 'utf8');
    console.log(`${file}: ${data.length} 条`);
  };
  write('commands.json', actionCommands);
  write('checkCommands.json', checkCommands);
  write('sysVariables.json', [...sysVars.values()].sort(byName));
  write('uiComponents.json', [...uiComps.values()].sort((a, b) => a.name.localeCompare(b.name)));
  write('triggers.json', [...triggers.values()].sort((a, b) => a.name.localeCompare(b.name)));
  console.log('完成.');
}

main().catch((e) => { console.error(e); process.exit(1); });
