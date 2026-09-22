/* 由命令数据库生成 TextMate 语法文件: node scripts/build-grammar.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const commands = require('../src/data/commands.json');
const checkCommands = require('../src/data/checkCommands.json');
const uiComponents = require('../src/data/uiComponents.json');

// 全部命令名(去重、长的在前避免前缀吞并), 行首大小写不敏感匹配
const names = [...new Set([...commands, ...checkCommands].map((c) => c.name))]
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const CMD_ALT = names.join('|');

// UI 组件名 + 常见兜底名
const compNames = [...new Set([...uiComponents.map((c) => c.name),
  'Text', 'RText', 'Img', 'Button', 'Layout', 'Input', 'CheckBox', 'ListView',
  'LoadingBar', 'ItemShow', 'GoodsShow', 'EquipShow', 'Effect', 'Frames',
  'DropDown', 'ScrollView', 'Slider', 'TabView', 'RichText', 'EditBox', 'Progress',
])].sort((a, b) => b.length - a.length);
const COMP_ALT = compNames.join('|');

// scope 配色基准: VSCode 默认 Dark+ 主题
//   entity.name.type -> 青(标签)   support.function -> 黄(命令)
//   support.variable -> 亮蓝(变量)  storage.type/modifier -> 蓝
//   entity.name.tag -> 蓝(组件)    entity.other.attribute-name -> 亮蓝(参数名)
//   string -> 橙(文本值)           constant.numeric -> 绿(数字)
//   keyword.control -> 紫(段标记)  comment -> 绿(注释)

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: '996M2 Script',
  scopeName: 'source.m2script',
  patterns: [
    { include: '#comments' },
    { include: '#sections' },
    { include: '#callCmd' },
    { include: '#sayLink' },
    { include: '#uiComponent' },
    { include: '#caretFn' },
    { include: '#sysVarCall' },
    { include: '#cfgRef' },
    { include: '#sysVar' },
    { include: '#strCall' },
    { include: '#customVarDecl' },
    { include: '#customVarOp' },
    { include: '#labelDef' },
    { include: '#namedVar' },
    { include: '#typedVar' },
    { include: '#mark' },
    { include: '#labelRef' },
    { include: '#commands' },
    { include: '#negation' },
    { include: '#numbers' },
    { include: '#operators' },
  ],
  repository: {
    comments: {
      patterns: [
        { name: 'comment.line.semicolon.m2script', match: '(^|\\s);.*$' },
        { name: 'comment.line.double-slash.m2script', match: '//.*$' },
      ],
    },
    sections: {
      name: 'keyword.control.section.m2script',
      match: '(?i)^\\s*#(ELSEACT|ELSESAY|ELSEIF|IFONE|AUTORUN|IF|ACT|SAY)\\b',
    },
    // #CALL [\子目录\文件.txt] @标签
    callCmd: {
      begin: '^(\\s*)((?i:#CALL))\\b',
      beginCaptures: {
        2: { name: 'support.function.command.m2script' },
      },
      end: '$',
      name: 'meta.call.m2script',
      patterns: [
        { include: '#comments' },
        { name: 'string.other.path.m2script', match: '\\[[^\\]]+\\]' },
        { include: '#labelRef' },
      ],
    },
    labelDef: {
      name: 'entity.name.type.label.m2script',
      match: '\\[@[^\\]\\s]+\\]',
    },
    labelRef: {
      name: 'entity.name.type.label.m2script',
      match: '@[A-Za-z0-9_\\-一-鿿]+',
    },
    // SAY 段链接: \<文字/@标签\>
    sayLink: {
      begin: '\\\\<',
      beginCaptures: { 0: { name: 'punctuation.definition.tag.m2script' } },
      end: '\\\\>',
      endCaptures: { 0: { name: 'punctuation.definition.tag.m2script' } },
      name: 'meta.link.m2script',
      patterns: [
        { include: '#labelRef' },
        { include: '#caretFn' },
        { include: '#cfgRef' },
        { include: '#sysVarCall' },
        { include: '#sysVar' },
        { name: 'string.other.link.m2script', match: '[^\\\\>@]+' },
      ],
    },
    // UI 组件: <Text|x=|y=|...>
    uiComponent: {
      begin: `(<)(${COMP_ALT})(?=[|>])`,
      beginCaptures: {
        1: { name: 'punctuation.definition.tag.begin.m2script' },
        2: { name: 'entity.name.tag.component.m2script' },
      },
      end: '>',
      endCaptures: { 0: { name: 'punctuation.definition.tag.end.m2script' } },
      name: 'meta.tag.component.m2script',
      patterns: [
        { include: '#caretFn' },
        { include: '#cfgRef' },
        { include: '#sysVarCall' },
        { include: '#sysVar' },
        { include: '#strCall' },
        { include: '#typedVar' },
        { include: '#labelRef' },
        { name: 'punctuation.separator.attribute.m2script', match: '\\|' },
        {
          match: '([A-Za-z_][A-Za-z0-9_]*)(=)',
          captures: {
            1: { name: 'entity.other.attribute-name.m2script' },
            2: { name: 'keyword.operator.assignment.m2script' },
          },
        },
        { name: 'string.other.value.m2script', match: '(?<==)[^|>=<]+' },
        { include: '#numbers' },
      ],
    },
    // <$STR(S0)> / <$HUMAN(变量)> / <$Money(2)>: 整体统一变量色
    sysVarCall: {
      begin: '(<\\$)((?i:STR|HUMAN|GUILD|GLOBAL|MONEY|BINDMONEY|PARAM|CUSTOMVALUE))(\\()',
      beginCaptures: {
        0: { name: 'support.variable.system.m2script' },
      },
      end: '(\\))(>)',
      endCaptures: {
        0: { name: 'support.variable.system.m2script' },
      },
      name: 'meta.variable.call.m2script',
      patterns: [
        { include: '#typedVar' },
        { include: '#namedVar' },
        { include: '#numbers' },
        { name: 'entity.name.variable.custom.m2script', match: '[A-Za-z0-9_一-鿿]+' },
      ],
    },
    // 通用 <$函数(参数)> 形式: <$cfg_名称(1_7)> / <$GetTypeBRow(...)> / <$TASKVAL(34)> 等
    cfgRef: {
      name: 'support.variable.system.m2script',
      match: '<\\$[A-Za-z][A-Za-z0-9_一-鿿]*\\([^>]*\\)>',
    },
    // <$USERNAME>: 整体统一变量色
    sysVar: {
      name: 'support.variable.system.m2script',
      match: '<\\$[A-Za-z0-9_]+>',
    },
    // $STR(A0) / $PARAM(0) / $996(xxx): 整体统一变量色
    strCall: {
      begin: '(\\$)((?i:STR|PARAM|996|MONEY|BINDMONEY|CUSTOMVALUE|GROUPCOMMON))(\\()',
      beginCaptures: {
        0: { name: 'support.variable.system.m2script' },
      },
      end: '(\\))',
      endCaptures: { 0: { name: 'support.variable.system.m2script' } },
      name: 'meta.variable.call.m2script',
      patterns: [
        { include: '#strCall' },
        { include: '#typedVar' },
        { include: '#namedVar' },
        { include: '#numbers' },
        { name: 'entity.name.variable.custom.m2script', match: '[A-Za-z0-9_一-鿿]+' },
      ],
    },
    // VAR String Human MyLover 自定义变量声明
    customVarDecl: {
      match: '^(\\s*)((?i:VAR))\\s+((?i:Integer|String))\\s+((?i:Global|Guild|Human))\\s+([^\\s;]+)',
      captures: {
        2: { name: 'support.function.command.m2script' },
        3: { name: 'storage.type.m2script' },
        4: { name: 'storage.modifier.m2script' },
        5: { name: 'entity.name.variable.custom.m2script' },
      },
    },
    // CALCVAR/CHECKVAR/SAVEVAR Global|Guild|Human 变量名
    customVarOp: {
      match: '^(\\s*)((?i:CALCVAR|CHECKVAR|SAVEVAR))\\s+((?i:Global|Guild|Human))\\s+([^\\s;]+)',
      captures: {
        2: { name: 'support.function.command.m2script' },
        3: { name: 'storage.modifier.m2script' },
        4: { name: 'entity.name.variable.custom.m2script' },
      },
    },
    namedVar: {
      name: 'variable.other.named.m2script',
      match: '\\b[A-Za-z]\\$[A-Za-z0-9_一-鿿]+',
    },
    typedVar: {
      name: 'variable.other.typed.m2script',
      match: '\\b[ASPDGIMUTJZaspgimutjz]\\d{1,3}\\b',
    },
    mark: {
      name: 'variable.other.mark.m2script',
      match: '\\[\\d{1,3}\\]',
    },
    negation: {
      name: 'keyword.operator.logical.not.m2script',
      match: '!(?=[A-Za-z])',
    },
    commands: {
      match: `^(\\s*)(!?)((?i:${CMD_ALT}))(?=\\s|$)`,
      captures: {
        2: { name: 'keyword.operator.logical.not.m2script' },
        3: { name: 'support.function.command.m2script' },
      },
    },
    // <$INC^A^B> / <$DEC^A^B> / <$PERMILL.A.B> 等运算取值函数
    caretFn: {
      name: 'support.variable.system.m2script',
      match: '<?\\$(?i:INC|DEC|MULT|DIV|PERCENT|PERMILL|TENTHOUSANDTH)(?=[\\^\\.])',
    },
    numbers: {
      name: 'constant.numeric.m2script',
      match: '(?<![A-Za-z0-9_])\\d+(\\.\\d+)?(?![A-Za-z0-9_])',
    },
    operators: {
      name: 'keyword.operator.m2script',
      match: '(?<![A-Za-z0-9_<>])[+*/=]|(?<![A-Za-z0-9_])-(?![A-Za-z0-9_])',
    },
  },
};

fs.writeFileSync(
  path.join(ROOT, 'syntaxes/m2script.tmLanguage.json'),
  JSON.stringify(grammar, null, 2),
  'utf8',
);
console.log(`语法已生成: ${names.length} 个命令, ${compNames.length} 个UI组件`);
