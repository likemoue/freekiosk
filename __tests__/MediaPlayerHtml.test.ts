/**
 * The playlist is written into a <script> of the player page. A title or an address typed in the
 * cloud's dashboard must come out as data, never end the script.
 */
export {};

jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { generatePlayerHTML } = require('../src/components/MediaPlayerComponent');

const SETTINGS = {
  autoPlay: true, loop: true, shuffle: false, imageDuration: 10, showControls: false,
  fitMode: 'contain', backgroundColor: '#000000', transitionEnabled: false, transitionDuration: 300,
  muteVideo: false, unattended: false,
};

const build = (title: string, url = 'https://cdn.test/a.mp4') =>
  generatePlayerHTML({ ...SETTINGS, items: [{ url, type: 'video', title }] });

describe('the playlist inside the player page', () => {
  it('cannot end the script from a title', () => {
    const html: string = build('</script><script>window.pwned = 1</script>');
    // one script block of the page's own, closed once
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(html).not.toContain('window.pwned = 1</script>');
  });

  it('cannot end the script from an address', () => {
    const html: string = build('x', 'https://cdn.test/</script><script>window.pwned = 1</script>.mp4');
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
  });

  it('still hands the exact text to the player once parsed', () => {
    const title = '</script> a "quote" \ back slash   <!-- end';
    const html: string = build(title);
    const line = html.split('\n').find((l: string) => l.includes('var playlist = ')) as string;
    const json = line.slice(line.indexOf('= ') + 2).replace(/;\s*$/, '');
    const playlist = new Function(`return ${json};`)();
    expect(playlist[0].title).toBe(title);
    expect(playlist[0].url).toBe('https://cdn.test/a.mp4');
  });
});

describe('web pages and YouTube videos inside the player page', () => {
  const html: string = generatePlayerHTML({
    ...SETTINGS,
    items: [
      { id: 'a', url: 'https://example.com/menu', type: 'web', duration: 20, title: '</script>' },
      { id: 'b', url: 'https://cloud.test/player/youtube/?v=dQw4w9WgXcQ', type: 'youtube', videoId: 'dQw4w9WgXcQ', duration: 45 },
    ],
  });

  it('hands the player the type, the id and the cap, as data', () => {
    const line = html.split('\n').find((l: string) => l.includes('var playlist = ')) as string;
    const json = line.slice(line.indexOf('= ') + 2).replace(/;\s*$/, '');
    const playlist = new Function(`return ${json};`)();
    expect(playlist[0]).toMatchObject({ type: 'web', url: 'https://example.com/menu', duration: 20, capSeconds: 0 });
    expect(playlist[1]).toMatchObject({ type: 'youtube', videoId: 'dQw4w9WgXcQ', capSeconds: 45 });
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
  });

  it('frames a page in a sandbox, without top navigation or popups, and not interactive', () => {
    expect(html).toContain("frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')");
    expect(html).not.toContain('allow-top-navigation');
    expect(html).not.toContain('allow-popups');
    expect(html).toContain('pointer-events: none');
  });

  it('skips a page and a video when the device is offline instead of showing an error frame', () => {
    expect(html).toContain('function isOffline()');
    // The page, the video, and the same two when playing in step with other screens
    expect((html.match(/if \(isOffline\(\)\)/g) || []).length).toBe(3);
  });

  it('plays a YouTube video through the cloud page, and listens to it only from that origin', () => {
    expect(html).toContain("item.url + (item.url.indexOf('?') >= 0 ? '&' : '?') + 'mute='");
    expect(html).toContain('ev.source !== frame.contentWindow || !playerOrigin || ev.origin !== playerOrigin');
    expect(html).toContain('if (state === 0 && shown) finish();');
    // the player page of this app has no origin, so it cannot ask YouTube itself (error 153)
    expect(html).not.toContain('https://www.youtube.com/embed/');
  });
});
