/** Import into a source site's score renderer after the replay site is published. */
export function replayURL(baseURL, completeStandardKifu, options = {}) {
  const url = new URL(baseURL);
  url.hash = new URLSearchParams({ kifu: completeStandardKifu, ...options }).toString();
  return url.href;
}
export function appendReplayLink(container, baseURL, completeStandardKifu, options = {}) {
  const link = document.createElement('a');
  link.href = replayURL(baseURL, completeStandardKifu, options);
  link.textContent = 'この数譜を検討'; link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.className = 'ghost-button compact'; container.append(link); return link;
}
