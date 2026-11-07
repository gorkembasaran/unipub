import { normalizePersonName } from './normalize-person-name';

describe('normalizePersonName', () => {
  it('preserves Turkish dotless i during ASCII normalization', () => {
    expect(normalizePersonName('Yılmaz Kemal YÜCE')).toBe(
      'yilmaz kemal yuce',
    );
  });

  it('removes source noise tokens from polluted provider names', () => {
    expect(normalizePersonName('EMRAH IRMAK - Google Akademik')).toBe(
      'emrah irmak',
    );
  });
});
