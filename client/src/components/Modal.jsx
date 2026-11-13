import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './ui.jsx';

export function Modal({ title, children, onClose, pending }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog ref={ref} className="ledger-dialog" aria-labelledby="ledger-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
      <header>
        <h2 id="ledger-dialog-title">{title}</h2>
        <Button type="button" variant="quiet" aria-label="Close dialog" onClick={onClose} disabled={pending}>
          <X size={18} aria-hidden="true" />
        </Button>
      </header>
      {children}
    </dialog>
  );
}
