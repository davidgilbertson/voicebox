export default function Select({
                                 value,
                                 onChange,
                                 ariaLabel,
                                 className = "",
                                 containerClassName = "",
                                 children,
                               }) {
  return (
      <div className={`relative inline-flex items-center ${containerClassName}`}>
        <select
            value={value}
            onChange={onChange}
            aria-label={ariaLabel}
            className={`appearance-none ${className}`}
        >
          {children}
        </select>
        <svg
            aria-hidden="true"
            viewBox="0 0 12 8"
            className="pointer-events-none absolute right-4 h-2 w-3 text-slate-400"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
  );
}
