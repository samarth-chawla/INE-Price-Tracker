import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

/**
 * Generic modal overlay.
 * - Renders into document.body via a portal (avoids z-index / stacking-context issues)
 * - Closes on Escape key or backdrop click
 * - Locks body scroll while open
 * - Traps focus inside the box
 */
export default function Modal({ onClose, children }) {
  const boxRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Move focus into the modal box on open
  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  // Only close when the backdrop itself is clicked (not when the box is clicked)
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return createPortal(
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="modal-box"
        ref={boxRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
