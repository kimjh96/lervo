import { Lexer, type Token, type Tokens } from "marked";
import { type ReactNode, useMemo } from "react";

import styles from "./Markdown.module.css";
import { MentionText } from "../../../agents";

/**
 * An agent's text as Markdown (CommonMark with GitHub's tables and strikethrough). The lexer's
 * tokens become React elements directly, so no HTML string is ever injected: raw HTML in the text
 * shows as text. Links show their text in the link color with the address as a hint; they do not
 * navigate the window.
 */
export default function Markdown(props: { text: string }) {
  const tokens = useMemo(() => Lexer.lex(props.text, { gfm: true }), [props.text]);
  return <div className={styles.markdown}>{blocks(tokens)}</div>;
}

function blocks(tokens: readonly Token[]): ReactNode[] {
  return tokens.map((token, index) => block(token, index));
}

function block(token: Token, key: number): ReactNode {
  switch (token.type) {
    case "heading": {
      const heading = token as Tokens.Heading;
      return (
        <p key={key} className={styles.heading} data-depth={Math.min(heading.depth, 3)}>
          {inline(heading.tokens)}
        </p>
      );
    }
    case "paragraph":
      return <p key={key}>{inline((token as Tokens.Paragraph).tokens)}</p>;
    case "code": {
      const code = token as Tokens.Code;
      return (
        <pre key={key} className={styles.code} data-language={code.lang || undefined}>
          <code>{code.text}</code>
        </pre>
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className={styles.quote}>
          {blocks((token as Tokens.Blockquote).tokens)}
        </blockquote>
      );
    case "list": {
      const list = token as Tokens.List;
      const items = list.items.map((item, index) => (
        // List items have no identity beyond their order within one immutable message.
        <li key={index}>
          {/* motion: A reply streams */}
          {item.task ? <span aria-hidden="true">{item.checked ? "☑ " : "☐ "}</span> : null}
          {listItem(item)}
        </li>
      ));
      return list.ordered ? (
        <ol
          key={key}
          className={styles.list}
          start={typeof list.start === "number" ? list.start : undefined}
        >
          {items}
        </ol>
      ) : (
        <ul key={key} className={styles.list}>
          {items}
        </ul>
      );
    }
    case "table": {
      const table = token as Tokens.Table;
      return (
        <div key={key} className={styles.tableFrame}>
          <table className={styles.table}>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th key={index} style={{ textAlign: cell.align ?? undefined }}>
                    {inline(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={{ textAlign: cell.align ?? undefined }}>
                      {inline(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "hr":
      return <hr key={key} className={styles.rule} />;
    case "space":
      return null;
    case "html":
      return <p key={key}>{(token as Tokens.HTML).text}</p>;
    default:
      return "tokens" in token && Array.isArray(token.tokens) ? (
        <p key={key}>{inline(token.tokens as Token[])}</p>
      ) : (
        <p key={key}>{"text" in token ? String(token.text) : ""}</p>
      );
  }
}

/** A list item's content: tight items hold inline text, loose ones hold blocks. */
function listItem(item: Tokens.ListItem): ReactNode {
  // The item's checkbox shows before its content.
  const content = item.tokens.filter((token) => token.type !== "checkbox");
  if (content.every((token) => token.type === "text" || token.type === "space"))
    return content.map((token, index) =>
      token.type === "text" ? (
        <span key={index}>{inline(textTokens(token as Tokens.Text))}</span>
      ) : null,
    );
  return blocks(content);
}

function textTokens(token: Tokens.Text): Token[] {
  return token.tokens ?? [{ type: "text", raw: token.raw, text: token.text } as Tokens.Text];
}

function inline(tokens: readonly Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, index) => span(token, index));
}

function span(token: Token, key: number): ReactNode {
  switch (token.type) {
    case "strong":
      return <strong key={key}>{inline((token as Tokens.Strong).tokens)}</strong>;
    case "em":
      return <em key={key}>{inline((token as Tokens.Em).tokens)}</em>;
    case "del":
      return <del key={key}>{inline((token as Tokens.Del).tokens)}</del>;
    case "codespan":
      return (
        <code key={key} className={styles.inlineCode}>
          {(token as Tokens.Codespan).text}
        </code>
      );
    case "link": {
      const link = token as Tokens.Link;
      return (
        <span key={key} className={styles.link} title={link.href}>
          {inline(link.tokens)}
        </span>
      );
    }
    case "image":
      return <span key={key}>{(token as Tokens.Image).text}</span>;
    case "br":
      return <br key={key} />;
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens === undefined ? (
        <MentionText key={key} text={text.text} />
      ) : (
        <span key={key}>{inline(text.tokens)}</span>
      );
    }
    default:
      return "text" in token ? String(token.text) : null;
  }
}
