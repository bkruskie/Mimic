/**
 * A small Markdown renderer for rules text from content packs: paragraphs, headings, lists, tables,
 * block quotes, bold and italic. It builds React elements, never HTML strings, so pack text can't inject markup.
 */
import { Fragment, type ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*\*[^*]+\*\*\*|\*\*_?[^*]+?_?\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const token = m[0];
    const key = `${keyBase}-${i++}`;
    if (token.startsWith("***")) out.push(<strong key={key}><em>{token.slice(3, -3)}</em></strong>);
    else if (token.startsWith("**")) out.push(<strong key={key}>{token.slice(2, -2).replace(/^_|_$/g, "")}</strong>);
    else out.push(<em key={key}>{token.slice(1, -1)}</em>);
    last = m.index! + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function Markdown({ text, className = "prose" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const key = `b${k++}`;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(4, heading[1]!.length));
      const Tag = `h${level}` as "h4" | "h5" | "h6";
      blocks.push(<Tag key={key}>{inline(heading[2]!.replace(/\*\*/g, ""), key)}</Tag>);
      i++;
      continue;
    }
    if (/^Table:\s/.test(line)) {
      blocks.push(<p key={key}><strong>{line.replace(/^Table:\s*/, "")}</strong></p>);
      i++;
      continue;
    }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("|")) {
        const r = cells(lines[i]!);
        if (!r.every((c) => /^-+$/.test(c))) rows.push(r);
        i++;
      }
      const [head, ...body] = rows;
      const hasHead = head && head.some((c) => c !== "");
      blocks.push(
        <table key={key}>
          {hasHead && (
            <thead>
              <tr>{head!.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr>
            </thead>
          )}
          <tbody>
            {(hasHead ? body : rows).map((r, ri) => (
              <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}${ri}-${j}`)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(<blockquote key={key}><Markdown text={quoted.join("\n")} className="" /></blockquote>);
      continue;
    }
    const bullet = /^\s*[-*]\s+/;
    const numbered = /^\s*\d+\.\s+/;
    if (bullet.test(line) || numbered.test(line)) {
      const ordered = numbered.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? numbered : bullet).test(lines[i]!)) {
        items.push(lines[i]!.replace(ordered ? numbered : bullet, ""));
        i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={key}>{items.map((it, j) => <li key={j}>{inline(it, `${key}${j}`)}</li>)}</List>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#{1,6}\s|\||\s*>|\s*[-*]\s|\s*\d+\.\s|Table:\s)/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    if (para.length === 0) {
      para.push(line);
      i++;
    }
    blocks.push(<p key={key}>{inline(para.join(" "), key)}</p>);
  }
  return className ? <div className={className}>{blocks}</div> : <Fragment>{blocks}</Fragment>;
}
