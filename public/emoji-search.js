import { emojiSticker, favoriteEmoji } from './emoji-stickers.js';

const key = emoji => emoji.replaceAll('️', '');
const words = text => text.normalize('NFKD').replace(/\p{Mark}/gu, '').toLowerCase().match(/[a-z0-9]+/g) || [];
const withTone = /[\u{1F3FB}-\u{1F3FF}]/u;
const tonesIn = /[\u{1F3FB}-\u{1F3FF}]/gu;

// The skin-tone choice: 0 is the default (yellow) emoji, 1–5 are the Fitzpatrick modifiers U+1F3FB–U+1F3FF.
export const skinTones = ['default', 'light', 'medium-light', 'medium', 'medium-dark', 'dark'];
export const skinToneNames = ['Default skin tone', 'Light skin tone', 'Medium-light skin tone', 'Medium skin tone', 'Medium-dark skin tone', 'Dark skin tone'];

const favorites = new Map(favoriteEmoji.map(entry => [key(entry[0]), entry]));

export function makeEmojiSearch(entries, groups) {
  const choices = entries.map(([emoji, officialName, keywords, group]) => {
    const favorite = favorites.get(key(emoji));
    const name = favorite?.[1] || officialName[0].toUpperCase() + officialName.slice(1);
    const nameTerms = words(officialName);
    const names = [nameTerms.join(' '), words(name).join(' ')];
    const terms = [...new Set([...nameTerms, ...words(`${name} ${keywords} ${favorite?.[2] || ''}`)])];
    const tone = withTone.test(emoji) && groups[group] !== 'Component';
    return { emoji, name, group, names, nameTerms, terms, tone, favorite: Boolean(favorite) };
  });
  const byEmoji = new Map(choices.map(choice => [key(choice.emoji), choice]));
  const byGroup = groups.map((_, index) => choices.filter(choice => choice.group === index));
  // Each emoji that takes a skin tone -> its five one-tone variants (every modifier in the sequence the same tone).
  // Mixed-tone sequences (two people in different tones) stay reachable by searching "skin" or "tone".
  const toned = new Map();
  for (const choice of choices) {
    if (!choice.tone) continue;
    const found = choice.emoji.match(tonesIn);
    if (new Set(found).size !== 1) continue;
    const base = byEmoji.get(key(choice.emoji.replace(tonesIn, '')));
    if (!base || base === choice) continue;
    if (!toned.has(base)) toned.set(base, []);
    toned.get(base)[found[0].codePointAt(0) - 0x1F3FA] = choice;
  }
  const inTone = (choice, tone) => (tone && toned.get(choice)?.[tone]) || choice;

  // find(query, group, tone) -> { entries: [[emoji, name]…] }. group -1 is Favorites; tone 0–5 (skinTones).
  return function find(query, group, tone = 0) {
    const pasted = emojiSticker(query);
    if (pasted) {
      const known = byEmoji.get(key(pasted));
      return { entries: [[pasted, known?.name || 'Pasted emoji']] };
    }
    const queryTerms = words(query);
    if (query.trim() && !queryTerms.length) return { entries: [] };
    if (!queryTerms.length && group === -1) {
      if (!tone) return { entries: favoriteEmoji };
      return { entries: favoriteEmoji.map(entry => {
        const choice = byEmoji.get(key(entry[0]));
        const variant = choice && toned.get(choice)?.[tone];
        return variant ? [variant.emoji, `${entry[1]}: ${skinToneNames[tone].toLowerCase()}`] : entry;
      }) };
    }

    let matches = byGroup[group] || [];
    if (queryTerms.length) {
      const phrase = queryTerms.join(' ');
      const score = choice => {
        if (choice.names.includes(phrase)) return 400;
        if (choice.names.some(name => name.startsWith(phrase))) return 300;
        if (queryTerms.every(term => choice.nameTerms.some(name => name.startsWith(term)))) return 200;
        return choice.favorite ? 100 : 0;
      };
      matches = choices
        .filter(choice => queryTerms.every(term => choice.terms.some(word => word.startsWith(term))))
        .map(choice => ({ choice, score: score(choice) }))
        .sort((a, b) => b.score - a.score)
        .map(({ choice }) => choice);
    }
    // A query that names a tone ("thumbs up skin tone", "skin") lists every variant; otherwise each emoji shows once,
    // in the chosen tone.
    const explicitTone = queryTerms.includes('tone') || queryTerms.includes('skin');
    const visible = explicitTone ? matches : matches.filter(choice => !choice.tone).map(choice => inTone(choice, tone));
    return { entries: visible.map(({ emoji, name }) => [emoji, name]) };
  };
}
