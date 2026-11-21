/**
 * 浏览器端纯前端下载：Blob + 临时 <a download>，不依赖任何第三方库。
 * 结束时释放对象 URL，避免内存泄漏。
 */
export function downloadTextFile(
  fileName: string,
  text: string,
  mime = 'text/plain',
): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}