// Word-level text normalization used to compare a recitation with the NIV text.
//
// The text is split into display tokens (words as they appear, with their
// position in the original string) and comparison units (lower-case words with
// punctuation removed, digits spelled out). A token usually yields one unit;
// "144,000" yields several.

const APOSTROPHES = /[’‘ʼ＇`´]/g;
const WORD_RE = /\d{1,3}(?:,\d{3})+|[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)*/gu;

export function tokenize(text) {
  const source = String(text ?? '');
  // Every apostrophe variant is a single UTF-16 unit, so indexes still line up.
  const scan = source.replace(APOSTROPHES, "'");
  const tokens = [];
  for (const match of scan.matchAll(WORD_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    tokens.push({ text: source.slice(start, end), start, end });
  }
  return tokens;
}

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

export const NUMBER_WORDS = new Set([...ONES, ...TENS.filter(Boolean), 'hundred', 'thousand', 'million']);

/** 16 -> ['sixteen'], 144000 -> ['one', 'hundred', 'forty', 'four', 'thousand'] */
export function numberToWords(n) {
  if (!Number.isSafeInteger(n) || n < 0) return [String(n)];
  if (n < 20) return [ONES[n]];
  if (n < 100) return n % 10 ? [TENS[Math.floor(n / 10)], ONES[n % 10]] : [TENS[n / 10]];
  if (n < 1000) {
    const rest = n % 100;
    return [ONES[Math.floor(n / 100)], 'hundred', ...(rest ? numberToWords(rest) : [])];
  }
  for (const [value, name] of SCALES) {
    if (n >= value) {
      const rest = n % value;
      return [...numberToWords(Math.floor(n / value)), name, ...(rest ? numberToWords(rest) : [])];
    }
  }
  return [String(n)];
}

const IRREGULAR_ORDINALS = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

/** 1 -> ['first'], 21 -> ['twenty', 'first'] */
export function ordinalWords(n) {
  const words = numberToWords(n);
  const last = words[words.length - 1];
  const ordinal = IRREGULAR_ORDINALS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words.slice(0, -1), ordinal];
}

/** Turns one display token into its comparison units. */
export function normalizeToken(raw) {
  let word = String(raw)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(APOSTROPHES, "'");
  if (/^\d{1,3}(?:,\d{3})+$/.test(word)) word = word.replace(/,/g, '');
  if (/^\d+$/.test(word)) return word.length <= 15 ? numberToWords(Number(word)) : [word];
  const ordinal = /^(\d+)(?:st|nd|rd|th)$/.exec(word);
  if (ordinal && ordinal[1].length <= 15) return ordinalWords(Number(ordinal[1]));
  return [word.replace(/'/g, '')];
}

export function toUnits(text) {
  const tokens = tokenize(text);
  const units = [];
  tokens.forEach((token, index) => {
    for (const word of normalizeToken(token.text)) units.push({ word, token: index });
  });
  return { text: String(text ?? ''), tokens, units };
}

// British spellings (NIV UK, some apps) mapped to the American NIV spelling.
const SPELLING_VARIANTS = {
  honour: 'honor', honours: 'honors', honoured: 'honored', honouring: 'honoring', honourable: 'honorable',
  dishonour: 'dishonor', dishonoured: 'dishonored', saviour: 'savior', favour: 'favor', favoured: 'favored',
  favourable: 'favorable', labour: 'labor', labours: 'labors', laboured: 'labored', labouring: 'laboring',
  neighbour: 'neighbor', neighbours: 'neighbors', colour: 'color', colours: 'colors', splendour: 'splendor',
  behaviour: 'behavior', harbour: 'harbor', rumour: 'rumor', rumours: 'rumors', valour: 'valor',
  vigour: 'vigor', odour: 'odor', armour: 'armor', endeavour: 'endeavor', fervour: 'fervor',
  clamour: 'clamor', savour: 'savor', judgement: 'judgment', judgements: 'judgments', fulfil: 'fulfill',
  fulfils: 'fulfills', fulfilment: 'fulfillment', worshipped: 'worshiped', worshipping: 'worshiping',
  worshipper: 'worshiper', worshippers: 'worshipers', travelled: 'traveled', travelling: 'traveling',
  traveller: 'traveler', counselled: 'counseled', counsellor: 'counselor', quarrelled: 'quarreled',
  grey: 'gray', centre: 'center', sceptre: 'scepter', plough: 'plow', ploughed: 'plowed',
  ploughman: 'plowman', defence: 'defense', offence: 'offense', offences: 'offenses', pretence: 'pretense',
  realise: 'realize', realised: 'realized', recognise: 'recognize', recognised: 'recognized',
  baptise: 'baptize', baptised: 'baptized', baptising: 'baptizing', criticise: 'criticize',
  sympathise: 'sympathize', emphasise: 'emphasize', organise: 'organize', apologise: 'apologize',
  agonise: 'agonize', jewellery: 'jewelry', mould: 'mold', smoulder: 'smolder', smouldering: 'smoldering',
  axe: 'ax', sceptic: 'skeptic', practise: 'practice', practised: 'practiced', licence: 'license',
  programme: 'program', storey: 'story', enquire: 'inquire', enquired: 'inquired',
};

export function canonicalSpelling(word) {
  return SPELLING_VARIANTS[word] ?? word;
}

// Words that sound the same. A speech recognizer cannot know which spelling was
// meant, so in voice mode these count as the same word. Only true homophones are
// listed: "lead"/"led" is left out because "lead" can also be said differently.
export const HOMOPHONE_GROUPS = [
  ['to', 'too', 'two'], ['for', 'four', 'fore'], ['one', 'won'], ['son', 'sun'], ['know', 'no'],
  ['knew', 'new'], ['knows', 'nose'], ['not', 'knot'], ['hear', 'here'], ['heard', 'herd'],
  ['whole', 'hole'], ['holy', 'wholly'], ['by', 'buy', 'bye'], ['right', 'write', 'rite'],
  ['see', 'sea'], ['seen', 'scene'], ['sees', 'seas', 'seize'], ['meet', 'meat', 'mete'],
  ['peace', 'piece'], ['pray', 'prey'], ['praise', 'prays', 'preys'], ['reign', 'rain', 'rein'],
  ['raise', 'rays', 'raze'], ['wait', 'weight'], ['way', 'weigh'], ['weak', 'week'], ['would', 'wood'],
  ['where', 'wear', 'ware'], ['which', 'witch'], ['whose', 'whos'], ['your', 'youre', 'yore'],
  ['their', 'there', 'theyre'], ['our', 'hour'], ['i', 'eye', 'aye'], ['be', 'bee'], ['do', 'due', 'dew'],
  ['die', 'dye'], ['died', 'dyed'], ['dying', 'dyeing'], ['so', 'sow', 'sew'], ['soul', 'sole'],
  ['some', 'sum'], ['soar', 'sore'], ['sword', 'soared'], ['throne', 'thrown'], ['through', 'threw', 'thru'],
  ['forth', 'fourth'], ['born', 'borne'], ['bear', 'bare'], ['bread', 'bred'], ['great', 'grate'],
  ['grown', 'groan'], ['heal', 'heel'], ['him', 'hymn'], ['in', 'inn'], ['idol', 'idle', 'idyll'],
  ['made', 'maid'], ['male', 'mail'], ['mourning', 'morning'], ['mourn', 'morn'], ['none', 'nun'],
  ['oh', 'o', 'owe'], ['or', 'oar', 'ore'], ['passed', 'past'], ['patience', 'patients'],
  ['presence', 'presents'], ['prince', 'prints'], ['principle', 'principal'], ['prophet', 'profit'],
  ['plain', 'plane'], ['pour', 'pore', 'poor'], ['real', 'reel'], ['reed', 'read'],
  ['road', 'rode', 'rowed'], ['rose', 'rows'], ['wrote', 'rote'], ['steal', 'steel'],
  ['straight', 'strait'], ['tale', 'tail'], ['tear', 'tier'], ['tents', 'tense'], ['time', 'thyme'],
  ['tied', 'tide'], ['vain', 'vein', 'vane'], ['waist', 'waste'], ['whether', 'weather'],
  ['wine', 'whine'], ['yoke', 'yolk'], ['altar', 'alter'], ['counsel', 'council'],
  ['sent', 'cent', 'scent'], ['sight', 'site', 'cite'], ['seem', 'seam'], ['sell', 'cell'],
  ['sale', 'sail'], ['main', 'mane'], ['missed', 'mist'], ['might', 'mite'], ['mind', 'mined'],
  ['need', 'knead'], ['night', 'knight'], ['flee', 'flea'], ['flour', 'flower'], ['feet', 'feat'],
  ['find', 'fined'], ['fair', 'fare'], ['high', 'hi'], ['hair', 'hare'], ['aloud', 'allowed'],
  ['ate', 'eight'], ['blew', 'blue'], ['build', 'billed'], ['birth', 'berth'], ['barren', 'baron'],
  ['bridle', 'bridal'], ['chaste', 'chased'], ['cymbal', 'symbol'], ['least', 'leased'], ['lie', 'lye'],
  ['liar', 'lyre'], ['lessen', 'lesson'], ['manner', 'manor'], ['mary', 'marry', 'merry'],
  ['pleas', 'please'], ['rest', 'wrest'], ['ring', 'wring'], ['role', 'roll'], ['shear', 'sheer'],
  ['shone', 'shown'], ['side', 'sighed'], ['stayed', 'staid'], ['tax', 'tacks'], ['taught', 'taut'],
  ['trust', 'trussed'], ['turn', 'tern'], ['very', 'vary'], ['vile', 'vial'], ['war', 'wore'],
  ['worn', 'warn'], ['we', 'wee'], ['world', 'whirled'], ['you', 'ewe', 'yew'], ['days', 'daze'],
  ['beat', 'beet'], ['bough', 'bow'], ['bruise', 'brews'], ['clause', 'claws'], ['earn', 'urn'],
  ['foul', 'fowl'], ['gate', 'gait'], ['guilt', 'gilt'], ['guest', 'guessed'], ['hall', 'haul'],
  ['higher', 'hire'], ['loan', 'lone'], ['minor', 'miner'], ['nay', 'neigh'], ['pail', 'pale'],
  ['pain', 'pane'], ['pair', 'pear', 'pare'], ['peak', 'peek'], ['stair', 'stare'], ['stake', 'steak'],
  ['suite', 'sweet'], ['ascent', 'assent'], ['complement', 'compliment'], ['wade', 'weighed'],
  ['wail', 'whale'], ['waive', 'wave'],
];

const SOUND_KEYS = new Map();
for (const group of HOMOPHONE_GROUPS) for (const word of group) SOUND_KEYS.set(word, group[0]);

/** Comparison key for voice mode: spelling variants and homophones collapse together. */
export function soundKey(word) {
  const spelled = canonicalSpelling(word);
  return SOUND_KEYS.get(spelled) ?? spelled;
}

/** "For God so loved" -> "F G s l" (punctuation kept), used as a memory hint. */
export function firstLetters(text) {
  const source = String(text ?? '');
  let out = '';
  let last = 0;
  for (const token of tokenize(source)) {
    out += source.slice(last, token.start) + Array.from(token.text)[0];
    last = token.end;
  }
  return out + source.slice(last);
}

export function countWords(text) {
  return tokenize(text).length;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}
