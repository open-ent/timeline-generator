import { ReactNode } from 'react';

/** Fenêtre modale simple (overlay + carte centrée), fermeture au clic hors carte / croix. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1050,
      }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded p-24"
        style={{ width: 'min(560px, 92vw)', maxHeight: '86vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="d-flex justify-content-between align-items-center mb-16">
          <h2 className="m-0" style={{ fontSize: 20 }}>
            {title}
          </h2>
          <button type="button" className="btn btn-link p-0" aria-label="Fermer" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default Modal;
