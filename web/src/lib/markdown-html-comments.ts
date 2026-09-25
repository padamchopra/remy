/// GitHub and Cursor wrap pull request bodies in HTML comments. Those markers
/// are not part of the text a person should read, so they come off before
/// markdown is parsed.
export function stripMarkdownHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n");
}
