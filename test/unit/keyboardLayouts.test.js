// Tests for the language registry (renderer/languages.js): one source of truth for what each
// language in the combo box looks like — its keyboard rows, its native name and whether it is
// right-to-left. The renderer loads the file as a plain script; these tests require() it.
const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { LANGUAGES, DEFAULT_LANGUAGE } = require('../../renderer/languages');

/** The <option> values of the language combo box in renderer/index.html, in order. */
function selectOptions() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
  return [...html.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
}

/** Every string key of the three letter rows, ignoring action keys and the row-4 punctuation. */
function lettersOf(variant) {
  return variant.slice(0, 3).flat().filter((k) => typeof k === 'string');
}

function hasAction(variant, action) {
  return variant.flat().some((k) => k && typeof k === 'object' && k.action === action);
}

describe('language registry', () => {
  it('covers exactly the languages the combo box offers, in the same order', () => {
    assert.deepStrictEqual(Object.keys(LANGUAGES), selectOptions());
    assert.strictEqual(DEFAULT_LANGUAGE, 'en-US');
    assert.ok(LANGUAGES[DEFAULT_LANGUAGE], 'the default language exists');
  });

  it('every language has a native name and a lower/symbols/alt_symbols variant of 4 non-empty rows', () => {
    for (const [tag, lang] of Object.entries(LANGUAGES)) {
      assert.strictEqual(typeof lang.name, 'string', `${tag} name`);
      assert.strictEqual(typeof lang.rtl, 'boolean', `${tag} rtl`);
      for (const variantName of ['lower', 'symbols', 'alt_symbols']) {
        const variant = lang.layouts[variantName];
        assert.ok(Array.isArray(variant), `${tag} has ${variantName}`);
        assert.strictEqual(variant.length, 4, `${tag} ${variantName} has 4 rows`);
        variant.forEach((row, i) => {
          assert.ok(Array.isArray(row) && row.length >= 1 && row.length <= 14, `${tag} ${variantName} row ${i + 1} has 1-14 keys`);
          row.forEach((key) => {
            const valid = typeof key === 'string' || (key && typeof key === 'object' && typeof key.label === 'string');
            assert.ok(valid, `${tag} ${variantName} row ${i + 1} has a valid key: ${JSON.stringify(key)}`);
          });
        });
      }
    }
  });

  it('every language has exactly one space key and one backspace in its letter layer', () => {
    for (const [tag, lang] of Object.entries(LANGUAGES)) {
      assert.ok(hasAction(lang.layouts.lower, 'space'), `${tag} has a space key`);
      assert.ok(hasAction(lang.layouts.lower, 'backspace'), `${tag} has a backspace key`);
      const row4 = lang.layouts.lower[3];
      assert.strictEqual(row4.filter((k) => k && k.action === 'space').length, 1, `${tag} has one space key`);
      const row3 = lang.layouts.lower[2];
      assert.strictEqual(row3.filter((k) => k && k.action === 'backspace').length, 1, `${tag} has one backspace key`);
    }
  });

  it('Hebrew covers all 27 letters of the standard Israeli layout', () => {
    const hebrew = 'אבגדהוזחטיכלמנסעפצקרשתךםןףץ';
    const got = lettersOf(LANGUAGES['he-IL'].layouts.lower).join('');
    assert.deepStrictEqual([...new Set(got)].sort(), [...hebrew].sort());
  });

  it('Russian covers all 33 Cyrillic letters and has matching uppercase rows', () => {
    const cyrillic = 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
    const lower = lettersOf(LANGUAGES['ru-RU'].layouts.lower).join('');
    assert.deepStrictEqual([...new Set(lower)].sort(), [...cyrillic].sort());
    const upper = LANGUAGES['ru-RU'].layouts.upper;
    assert.ok(upper, 'Russian has an uppercase variant');
    assert.strictEqual(lettersOf(upper).join('').toLowerCase(), lettersOf(LANGUAGES['ru-RU'].layouts.lower).join(''));
  });

  it('Arabic covers the 28 base letters plus ء ة ئ ؤ ى', () => {
    const arabic = 'ابتثجحخدذرزسشصضطظعغفقكلمنهويءةئؤى';
    const got = lettersOf(LANGUAGES['ar-SA'].layouts.lower).join('');
    assert.deepStrictEqual([...new Set(got)].sort(), [...arabic].sort());
  });

  it('German is QWERTZ with umlauts and ß, French is AZERTY with accents, Spanish has ñ and acute vowels', () => {
    const de = lettersOf(LANGUAGES['de-DE'].layouts.lower).join('');
    assert.ok(de.includes('qwertz') && de.includes('ü') && de.includes('ö') && de.includes('ä') && de.includes('ß'), `German: ${de}`);
    assert.ok(de.startsWith('q'), 'German row 1 starts with q');

    const fr = LANGUAGES['fr-FR'].layouts.lower;
    assert.strictEqual(lettersOf([fr[0]]).join(''), 'azertyuiop', 'French row 1 is AZERTY');
    assert.strictEqual(lettersOf([fr[1]]).join(''), 'qsdfghjklm', 'French row 2');
    assert.ok(lettersOf([fr[2]]).join('').includes('éèàç'), 'French row 3 has é è à ç');

    const es = LANGUAGES['es-ES'].layouts.lower;
    assert.strictEqual(lettersOf([es[1]]).join(''), 'asdfghjklñ', 'Spanish row 2 has ñ');
    assert.ok(lettersOf([es[2]]).join('').includes('áéíóú'), 'Spanish row 3 has acute vowels');
  });

  it('cased languages have a shift key and an uppercase variant; Hebrew and Arabic have neither', () => {
    for (const [tag, lang] of Object.entries(LANGUAGES)) {
      const caseless = tag === 'he-IL' || tag === 'ar-SA';
      assert.strictEqual(lang.rtl, caseless, `${tag} rtl flag`);
      assert.strictEqual(hasAction(lang.layouts.lower, 'shift'), !caseless, `${tag} shift key`);
      assert.strictEqual(Boolean(lang.layouts.upper), !caseless, `${tag} uppercase variant`);
      if (!caseless) {
        assert.strictEqual(
          lettersOf(lang.layouts.upper).join('').toLowerCase(),
          lettersOf(lang.layouts.lower).join(''),
          `${tag} uppercase matches lowercase`
        );
      }
    }
  });

  it('right-to-left languages mirror the action keys: backspace and enter left, symbols switch right', () => {
    for (const tag of ['he-IL', 'ar-SA']) {
      const lower = LANGUAGES[tag].layouts.lower;
      assert.strictEqual(lower[2][0].action, 'backspace', `${tag} row 3 starts with backspace`);
      assert.strictEqual(lower[3][0].action, 'enter', `${tag} row 4 starts with enter`);
      assert.strictEqual(lower[3].at(-1).action, 'symbols', `${tag} row 4 ends with the symbols switch`);
    }
    // Left-to-right languages keep today's arrangement: shift left, backspace right.
    const en = LANGUAGES['en-US'].layouts.lower;
    assert.strictEqual(en[2][0].action, 'shift');
    assert.strictEqual(en[2].at(-1).action, 'backspace');
    assert.strictEqual(en[3][0].action, 'symbols');
    assert.strictEqual(en[3].at(-1).action, 'enter');
  });

  it('Chinese types pinyin on the English QWERTY rows', () => {
    assert.strictEqual(LANGUAGES['zh-CN'].layouts, LANGUAGES['en-US'].layouts, 'zh-CN shares the en-US layout');
    assert.strictEqual(LANGUAGES['zh-CN'].name, '中文');
  });

  it('the shared symbol layers cover / ¿ ¡ and every language uses them', () => {
    const symbols = LANGUAGES['en-US'].layouts.symbols;
    const altSymbols = LANGUAGES['en-US'].layouts.alt_symbols;
    assert.ok(lettersOf([symbols[1]]).includes('/'), 'symbols layer has /');
    assert.ok(lettersOf([altSymbols[0]]).includes('¿') && lettersOf([altSymbols[0]]).includes('¡'), 'alt symbols has ¿ ¡');
    for (const lang of Object.values(LANGUAGES)) {
      assert.strictEqual(lang.layouts.symbols, symbols, `${lang.name} shares the symbols layer`);
      assert.strictEqual(lang.layouts.alt_symbols, altSymbols, `${lang.name} shares the alt symbols layer`);
    }
  });

  it('every language names the space bar in its own script', () => {
    assert.strictEqual(LANGUAGES['he-IL'].name, 'עברית');
    assert.strictEqual(LANGUAGES['ar-SA'].name, 'العربية');
    assert.strictEqual(LANGUAGES['en-US'].name, 'English');
    assert.strictEqual(LANGUAGES['ru-RU'].name, 'Русский');
  });
});
