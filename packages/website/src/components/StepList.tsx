export interface Step {
  title: string
  body: string
}

/** Numbered steps between hairlines, as on the /app, /connect and /invite pages. */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="border-b border-line">
      {steps.map((step, index) => (
        <li key={step.title} className="flex gap-4 py-4 border-t border-line">
          <span className="w-7 h-7 flex-shrink-0 rounded-full border border-line-strong text-fg-2 font-mono text-sm flex items-center justify-center">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-fg">{step.title}</p>
            <p className="text-sm text-fg-2">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
