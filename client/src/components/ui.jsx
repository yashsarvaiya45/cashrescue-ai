export function Button({ children, variant = 'secondary', className = '', ...props }) {
  return <button className={'button button-' + variant + ' ' + className} {...props}>{children}</button>;
}

export function Badge({ children, tone = 'neutral' }) {
  return <span className={'badge badge-' + tone}>{children}</span>;
}

export function Panel({ className = '', ...props }) {
  return <section className={'panel ' + className} {...props} />;
}

export function SectionIcon({ icon: Icon, tone = 'emerald' }) {
  return <span className={'section-icon icon-' + tone}><Icon size={18} aria-hidden="true" /></span>;
}
