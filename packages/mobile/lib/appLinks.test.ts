import { describe, it, expect } from 'vitest';
import { appLinkPath, parseAppLink, redirectAppLink } from './appLinks';
import { inviteLink } from './invites';

const SECRET = 'Qm9vX2Jhcl9iYXpfcXV4eA'; // 22 chars, base64url
const TOKEN = 'sgi_' + 'a'.repeat(32);

describe('parseAppLink: connect', () => {
  it('reads the https link with values in the fragment', () => {
    expect(
      parseAppLink(
        `https://skyglass.dev/connect#h=192.168.1.27&p=3001&pair=${SECRET}&m=Hangar%20mirror`
      )
    ).toEqual({
      kind: 'connect',
      host: '192.168.1.27',
      port: 3001,
      pair: SECRET,
      name: 'Hangar mirror',
    });
  });

  it('accepts www, a trailing slash, an upper-case host and no pair or name', () => {
    expect(parseAppLink('https://WWW.skyglass.dev/connect/#h=skyglass.local&p=3001')).toEqual({
      kind: 'connect',
      host: 'skyglass.local',
      port: 3001,
    });
  });

  it('defaults the port to 3001', () => {
    expect(parseAppLink('https://skyglass.dev/connect#h=10.0.0.5')).toMatchObject({ port: 3001 });
  });

  it('reads the old skyglass:// link', () => {
    expect(parseAppLink(`skyglass://connect?host=192.168.1.27&port=3001&pair=${SECRET}`)).toEqual({
      kind: 'connect',
      host: '192.168.1.27',
      port: 3001,
      pair: SECRET,
    });
    expect(parseAppLink('skyglass:///connect?host=10.0.0.2&port=8080')).toMatchObject({
      host: '10.0.0.2',
      port: 8080,
    });
  });

  it('reads the Expo Go dev link and ignores its reset nonce', () => {
    expect(
      parseAppLink('exp://192.168.1.27:8081/--/connect?host=192.168.1.27&port=3001&reset=abc')
    ).toEqual({ kind: 'connect', host: '192.168.1.27', port: 3001 });
  });

  it('cleans the mirror name', () => {
    const link = parseAppLink(
      `https://skyglass.dev/connect#h=10.0.0.5&m=${encodeURIComponent(' Den\u0007 ' + 'x'.repeat(100))}`
    );
    expect(link).toMatchObject({ kind: 'connect' });
    const name = link?.kind === 'connect' ? link.name : undefined;
    expect(name?.startsWith('Den x')).toBe(true);
    expect(name?.length).toBeLessThanOrEqual(64);
  });

  it.each([
    ['bad host', 'https://skyglass.dev/connect#h=evil.com/x&p=3001'],
    ['host with spaces', 'https://skyglass.dev/connect#h=a%20b'],
    ['no host', 'https://skyglass.dev/connect#p=3001'],
    ['port out of range', 'https://skyglass.dev/connect#h=10.0.0.5&p=70000'],
    ['port not a number', 'https://skyglass.dev/connect#h=10.0.0.5&p=30a'],
    ['bad secret', 'https://skyglass.dev/connect#h=10.0.0.5&pair=no%20way'],
    ['bad escape', 'https://skyglass.dev/connect#h=%E0%A4%A'],
    ['other host', 'https://evil.example/connect#h=10.0.0.5'],
    ['http', 'http://skyglass.dev/connect#h=10.0.0.5'],
    ['other path', 'https://skyglass.dev/pricing#h=10.0.0.5'],
    ['other scheme', 'otherapp://connect?host=10.0.0.5'],
    ['plain text', 'hello'],
    ['empty', ''],
  ])('rejects %s', (_label, text) => {
    expect(parseAppLink(text)).toBeNull();
  });
});

describe('parseAppLink: invite', () => {
  it('reads the links lib/invites makes', () => {
    const url = inviteLink({
      host: '192.168.1.27',
      port: 3001,
      token: TOKEN,
      personName: 'Sam',
      mirrorName: 'Hall',
    });
    expect(parseAppLink(url)).toEqual({
      kind: 'invite',
      host: '192.168.1.27',
      port: 3001,
      token: TOKEN,
    });
  });

  it('reads the skyglass://invite hand-off', () => {
    expect(parseAppLink(`skyglass://invite?host=10.0.0.5&port=3001&token=${TOKEN}`)).toEqual({
      kind: 'invite',
      host: '10.0.0.5',
      port: 3001,
      token: TOKEN,
    });
  });

  it('rejects a bad token', () => {
    expect(parseAppLink('https://skyglass.dev/invite#h=10.0.0.5&p=3001&t=nope')).toBeNull();
  });
});

describe('appLinkPath', () => {
  it('builds the connect route with encoded values', () => {
    expect(
      appLinkPath({ kind: 'connect', host: '10.0.0.5', port: 3001, pair: SECRET, name: 'A & B' })
    ).toBe(`/connect?host=10.0.0.5&port=3001&pair=${SECRET}&name=A%20%26%20B`);
    expect(appLinkPath({ kind: 'connect', host: '10.0.0.5', port: 3001 })).toBe(
      '/connect?host=10.0.0.5&port=3001'
    );
  });

  it('builds the invite route', () => {
    expect(appLinkPath({ kind: 'invite', host: '10.0.0.5', port: 3001, token: TOKEN })).toBe(
      `/invite?host=10.0.0.5&port=3001&token=${TOKEN}`
    );
  });
});

describe('redirectAppLink', () => {
  it('rewrites the https connect link', () => {
    expect(
      redirectAppLink(`https://skyglass.dev/connect#h=192.168.1.27&p=3001&pair=${SECRET}&m=Den`)
    ).toBe(`/connect?host=192.168.1.27&port=3001&pair=${SECRET}&name=Den`);
  });

  it('rewrites the https invite link', () => {
    expect(
      redirectAppLink(`https://www.skyglass.dev/invite#h=10.0.0.5&p=3001&t=${TOKEN}&n=Sam&m=Hall`)
    ).toBe(`/invite?host=10.0.0.5&port=3001&token=${TOKEN}`);
  });

  it('rewrites a bare path that kept the fragment', () => {
    expect(redirectAppLink('/connect#h=10.0.0.5&p=3001')).toBe('/connect?host=10.0.0.5&port=3001');
  });

  it('sends broken or unknown skyglass.dev links home', () => {
    expect(redirectAppLink('https://skyglass.dev/connect#h=../../etc')).toBe('/');
    expect(redirectAppLink('https://skyglass.dev/connect')).toBe('/');
    expect(redirectAppLink('https://skyglass.dev/invite#h=10.0.0.5&t=bad')).toBe('/');
    expect(redirectAppLink('https://skyglass.dev/store')).toBe('/');
    expect(redirectAppLink('/connect#junk')).toBe('/');
  });

  it.each([
    'skyglass://connect?host=10.0.0.5&port=3001',
    'exp://192.168.1.27:8081/--/connect?host=192.168.1.27&port=3001',
    'skyglass://invite?host=10.0.0.5&port=3001&token=x',
    'com.skyglass.app:/oauth/google?code=abc',
    '/connect?host=10.0.0.5&port=3001',
    '/dashboard',
    'https://example.com/connect#h=10.0.0.5',
  ])('passes %s through unchanged', (path) => {
    expect(redirectAppLink(path)).toBe(path);
  });
});

describe('the link the mirror emits', () => {
  // https://skyglass.dev/connect#h=<host>&p=3001&m=<name>&pair=<secret>, each value encoded.
  const emit = (origin: string, host: string, name?: string) =>
    `${origin}/connect#h=${encodeURIComponent(host)}&p=3001` +
    (name ? `&m=${encodeURIComponent(name)}` : '') +
    `&pair=${encodeURIComponent(SECRET)}`;

  it.each(['192.168.1.27', 'skyglass.local', 'fe80::1', 'fe80::1%en0', '2001:db8::42'])(
    'accepts host %s',
    (host) => {
      expect(parseAppLink(emit('https://skyglass.dev', host, 'Hangar'))).toEqual({
        kind: 'connect',
        host,
        port: 3001,
        pair: SECRET,
        name: 'Hangar',
      });
    }
  );

  it('accepts a bracketed IPv6 host too', () => {
    expect(parseAppLink('https://skyglass.dev/connect#h=%5Bfe80%3A%3A1%5D')).toMatchObject({
      host: 'fe80::1',
    });
  });

  it('round-trips an IPv6 host through +native-intent', () => {
    expect(redirectAppLink(emit('https://skyglass.dev', 'fe80::1'))).toBe(
      `/connect?host=fe80%3A%3A1&port=3001&pair=${SECRET}`
    );
  });

  it('accepts a staging origin only in the scanner', () => {
    const link = emit('https://staging.example.app', '10.0.0.5', 'Den');
    expect(parseAppLink(link)).toBeNull();
    expect(parseAppLink(link, { anyOrigin: true })).toMatchObject({
      host: '10.0.0.5',
      name: 'Den',
    });
    expect(redirectAppLink(link)).toBe(link);
    // Still https, still /connect, still fragment values.
    expect(
      parseAppLink('http://staging.example.app/connect#h=10.0.0.5', { anyOrigin: true })
    ).toBeNull();
    expect(
      parseAppLink('https://staging.example.app/invite#h=10.0.0.5', { anyOrigin: true })
    ).toBeNull();
    expect(
      parseAppLink('https://staging.example.app/connect?h=10.0.0.5', { anyOrigin: true })
    ).toBeNull();
  });
});
