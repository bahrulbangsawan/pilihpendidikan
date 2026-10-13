// Display formats the CV templates share with the other builders: moved here
// from @rulisme/ui/lib/utils, which re-exports them, so the PDF templates and
// the api Worker can use them without the UI library.

const NON_DIGIT_RE = /\D/g;
const HTTP_PROTOCOL_RE = /^https?:\/\//i;

/** A phone number grouped in fours from the right: "+62812-3456-7890". */
export function formatPhoneDisplay(phone: string): string {
  if (!phone) {
    return phone;
  }

  const hasPlus = phone.startsWith("+");
  const digits = phone.replace(NON_DIGIT_RE, "");

  if (digits.length <= 4) {
    return (hasPlus ? "+" : "") + digits;
  }

  const groups: string[] = [];
  let i = digits.length;

  while (i > 0) {
    const start = Math.max(0, i - 4);
    groups.unshift(digits.slice(start, i));
    i = start;
  }

  // Merge a lone leading digit into the next group
  const first = groups[0];
  const second = groups[1];
  if (groups.length > 1 && first && second && first.length === 1) {
    groups[0] = first + second;
    groups.splice(1, 1);
  }

  return (hasPlus ? "+" : "") + groups.join("-");
}

/** A link with its scheme: "example.com" becomes "https://example.com". */
export function ensureUrl(url: string): string {
  if (!url) {
    return url;
  }
  if (HTTP_PROTOCOL_RE.test(url)) {
    return url;
  }
  return `https://${url}`;
}
