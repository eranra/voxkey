// The language registry: what every language in the combo box looks like.
// One source of truth for the keyboard rows, the space-bar label and the text direction.
// The keyboard page loads this file as a plain script (CSP allows only own files); the tests
// load it with require(). Keys are the <option> values of the combo box in renderer/index.html.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.VoxKeyLanguages = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const shift = { action: 'shift', label: '⇧' };
  const shiftActive = { action: 'shift', label: '⬆', active: true };
  const backspace = { action: 'backspace', label: '⌫' };
  const space = (name) => ({ action: 'space', label: name });
  const enter = { action: 'enter', label: '↵' };
  const toSymbols = { action: 'symbols', label: '?123' };
  const toAltSymbols = { action: 'alt_symbols', label: '=<\u2009' };
  const toAbc = { action: 'abc', label: 'ABC' };

  // Digit and punctuation layers, shared by every language.
  const SYMBOLS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '%', '&', '/', '-', '+', '(', ')'],
    [toAltSymbols, '*', '"', '\'', ':', ';', '!', '?', backspace],
    [toAbc, ',', space(''), '.', enter]
  ];

  const ALT_SYMBOLS = [
    ['~', '`', '|', '•', '¿', '¡', '÷', '×', '§', 'Δ'],
    ['£', '€', '¥', '¢', '^', '°', '=', '{', '}'],
    [toSymbols, '\\', '<', '>', '[', ']', '_', '—', backspace],
    [toAbc, ',', space(''), '.', enter]
  ];

  // Rows are written in visual left-to-right order, the way they appear on screen.
  // Right-to-left languages keep their letters at the physical positions of the national
  // layout and mirror only the action keys (backspace and enter at the left end, the
  // symbols switch at the right end), like iOS and Android Hebrew and Arabic keyboards.
  // Caseless scripts (Hebrew, Arabic) have no shift key and no uppercase variant.

  const QWERTY = {
    lower: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
      [shift, 'z', 'x', 'c', 'v', 'b', 'n', 'm', backspace],
      [toSymbols, ',', space('English'), '.', enter]
    ],
    upper: [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
      [shiftActive, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', backspace],
      [toSymbols, ',', space('English'), '.', enter]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const HEBREW = {
    lower: [
      ['ק', 'ר', 'א', 'ט', 'ו', 'ן', 'ם', 'פ'],
      ['ש', 'ד', 'ג', 'כ', 'ע', 'י', 'ח', 'ל', 'ך', 'ף'],
      [backspace, 'ז', 'ס', 'ב', 'ה', 'נ', 'מ', 'צ', 'ת', 'ץ'],
      [enter, '.', space('עברית'), ',', toSymbols]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const ARABIC = {
    lower: [
      ['ض', 'ص', 'ث', 'ق', 'ف', 'غ', 'ع', 'ه', 'خ', 'ح', 'ج', 'د'],
      ['ش', 'س', 'ي', 'ب', 'ل', 'ا', 'ت', 'ن', 'م', 'ك', 'ط'],
      [backspace, 'ئ', 'ء', 'ؤ', 'ر', 'ى', 'ة', 'و', 'ز', 'ظ', 'ذ'],
      [enter, '.', space('العربية'), '،', toSymbols]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const RUSSIAN = {
    lower: [
      ['й', 'ц', 'у', 'к', 'е', 'н', 'г', 'ш', 'щ', 'з', 'х', 'ъ'],
      ['ф', 'ы', 'в', 'а', 'п', 'р', 'о', 'л', 'д', 'ж', 'э'],
      [shift, 'я', 'ч', 'с', 'м', 'и', 'т', 'ь', 'б', 'ю', 'ё', backspace],
      [toSymbols, ',', space('Русский'), '.', enter]
    ],
    upper: [
      ['Й', 'Ц', 'У', 'К', 'Е', 'Н', 'Г', 'Ш', 'Щ', 'З', 'Х', 'Ъ'],
      ['Ф', 'Ы', 'В', 'А', 'П', 'Р', 'О', 'Л', 'Д', 'Ж', 'Э'],
      [shiftActive, 'Я', 'Ч', 'С', 'М', 'И', 'Т', 'Ь', 'Б', 'Ю', 'Ё', backspace],
      [toSymbols, ',', space('Русский'), '.', enter]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const GERMAN = {
    lower: [
      ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'],
      [shift, 'y', 'x', 'c', 'v', 'b', 'n', 'm', 'ß', backspace],
      [toSymbols, ',', space('Deutsch'), '.', enter]
    ],
    upper: [
      ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
      [shiftActive, 'Y', 'X', 'C', 'V', 'B', 'N', 'M', 'ß', backspace],
      [toSymbols, ',', space('Deutsch'), '.', enter]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const FRENCH = {
    lower: [
      ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm'],
      [shift, 'w', 'x', 'c', 'v', 'b', 'n', 'é', 'è', 'à', 'ç', backspace],
      [toSymbols, ',', space('Français'), '.', enter]
    ],
    upper: [
      ['A', 'Z', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['Q', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
      [shiftActive, 'W', 'X', 'C', 'V', 'B', 'N', 'É', 'È', 'À', 'Ç', backspace],
      [toSymbols, ',', space('Français'), '.', enter]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const SPANISH = {
    lower: [
      ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
      ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
      [shift, 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'á', 'é', 'í', 'ó', 'ú', backspace],
      [toSymbols, ',', space('Español'), '.', enter]
    ],
    upper: [
      ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
      ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ñ'],
      [shiftActive, 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'Á', 'É', 'Í', 'Ó', 'Ú', backspace],
      [toSymbols, ',', space('Español'), '.', enter]
    ],
    symbols: SYMBOLS,
    alt_symbols: ALT_SYMBOLS
  };

  const LANGUAGES = {
    'en-US': { name: 'English', rtl: false, layouts: QWERTY },
    'en-GB': { name: 'English (UK)', rtl: false, layouts: QWERTY },
    'es-ES': { name: 'Español', rtl: false, layouts: SPANISH },
    'fr-FR': { name: 'Français', rtl: false, layouts: FRENCH },
    'de-DE': { name: 'Deutsch', rtl: false, layouts: GERMAN },
    'he-IL': { name: 'עברית', rtl: true, layouts: HEBREW },
    'ar-SA': { name: 'العربية', rtl: true, layouts: ARABIC },
    'ru-RU': { name: 'Русский', rtl: false, layouts: RUSSIAN },
    'zh-CN': { name: '中文', rtl: false, layouts: QWERTY }
  };

  return { LANGUAGES, DEFAULT_LANGUAGE: 'en-US' };
});
