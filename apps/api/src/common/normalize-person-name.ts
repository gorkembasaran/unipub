const PERSON_NAME_NOISE_TOKENS = new Set([
  'google',
  'scholar',
  'akademik',
  'citation',
  'citations',
  'profile',
  'profiles',
  'profil',
  'author',
  'authors',
]);

export function normalizePersonName(value: string) {
  const normalized = value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return '';
  }

  return normalized
    .split(' ')
    .filter((token) => token && !PERSON_NAME_NOISE_TOKENS.has(token))
    .join(' ');
}
