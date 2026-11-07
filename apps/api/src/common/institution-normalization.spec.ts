import {
  areInstitutionNamesEquivalent,
  extractInstitutionNameCandidate,
} from './institution-normalization';

describe('institution normalization', () => {
  it('extracts scholar and affiliation style university names', () => {
    expect(
      extractInstitutionNameCandidate(
        'Adem Tekin. Istanbul Technical University. Verified email at itu.edu.tr - Homepage',
      ),
    ).toBe('Istanbul Technical University');

    expect(
      extractInstitutionNameCandidate(
        'İstanbul Teknik Üniversitesi, Bilişim Enstitüsü, İstanbul, Türkiye',
      ),
    ).toBe('İstanbul Teknik Üniversitesi');
  });

  it('treats Turkish and English variants of the same institution as equivalent', () => {
    expect(
      areInstitutionNamesEquivalent(
        'Istanbul Technical University',
        'İstanbul Teknik Üniversitesi',
      ),
    ).toBe(true);
  });

  it('does not merge different technical universities just because they share generic tokens', () => {
    expect(
      areInstitutionNamesEquivalent(
        'İstanbul Teknik Üniversitesi',
        'Orta Doğu Teknik Üniversitesi',
      ),
    ).toBe(false);

    expect(
      areInstitutionNamesEquivalent(
        'İstanbul Teknik Üniversitesi',
        'Eskişehir Teknik Üniversitesi',
      ),
    ).toBe(false);
  });
});
