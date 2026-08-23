export function TypingDots() {
  return (
    <span aria-hidden="true" data-testid="typing-dots" className="flex items-center gap-0.5">
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="typing-dot"
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </span>
  );
}
