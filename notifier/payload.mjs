// The push message. It carries NO build data, only the kind of notification and generic
// fallback text. The phone builds the real question from its own copy of builds.json.
//
// Format: Declarative Web Push (W3C Push API; Safari / iOS 18.4+):
//   - "web_push": 8030 marks it as declarative.
//   - "notification" needs "title" and an absolute "navigate" URL.
//   - "mutable": true sits ALONGSIDE "notification" (not inside it). It lets the service worker
//     replace the declared notification with the real question. If the service worker fails,
//     iOS shows the declared one instead, so there's always something.
// Older iOS versions and other browsers just get this JSON as normal push data.

export const DECLARATIVE_MAGIC = 8030;

export const FALLBACK_TEXT = {
  quiz: '\u{1F355} Quiz time, tap to practise',
  summary: '\u{1F355} Time for a quick practice, tap to start',
};

export function buildPayload(type, appUrl) {
  const kind = type === 'summary' ? 'summary' : 'quiz';
  const base = new URL(appUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') {
    throw new Error(`APP_URL must be an https:// address, got ${appUrl}`);
  }
  const navigate = new URL('#/quiz/due', base).href;
  return {
    web_push: DECLARATIVE_MAGIC,
    notification: {
      title: 'Makeline',
      body: FALLBACK_TEXT[kind],
      navigate,
      tag: kind,
      lang: 'en-GB',
      dir: 'ltr',
      data: { type: kind },
    },
    mutable: true,
  };
}

/** https://owner.github.io/repo/ from "owner/repo" (GitHub lowercases the owner in Pages URLs). */
export function pagesUrl(repository) {
  const [owner, repo] = String(repository || '').split('/');
  if (!owner || !repo) throw new Error('GITHUB_REPOSITORY should look like "owner/repo".');
  if (repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) return `https://${owner.toLowerCase()}.github.io/`;
  return `https://${owner.toLowerCase()}.github.io/${repo}/`;
}
