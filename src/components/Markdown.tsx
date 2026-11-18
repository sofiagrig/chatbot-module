import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renders a bot answer. Raw HTML in the text is not rendered (react-markdown default). */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
