import React from 'react';

/**
 * Accessible, responsive ToggleSwitch component matching the MemorAid theme.
 *
 * Designed to provide:
 * 1. High tactile feedback with smooth cubic-bezier transitions.
 * 2. Full keyboard accessibility (Tab, Space/Enter) with WCAG AAA visible focus rings.
 * 3. Screen-reader friendly semantic `role="switch"` and `aria-checked`.
 * 4. High contrast and dark mode support aligned with MemorAid's design tokens.
 */
export default function ToggleSwitch({
  id,
  name,
  checked = false,
  onChange,
  disabled = false,
  label,
  description,
  labelPosition = 'left',
  size = 'md',
  className = '',
  ariaLabel,
}) {
  const switchId = id || (name ? `toggle-${name}` : undefined);

  const handleChange = (e) => {
    if (disabled) return;
    if (onChange) {
      onChange(e.target.checked, e);
    }
  };

  const hasText = Boolean(label || description);

  return (
    <label
      htmlFor={switchId}
      className={`toggle-switch-card toggle-switch-card--${size} ${labelPosition === 'left' ? 'is-label-left' : 'is-label-right'} ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}
    >
      {labelPosition === 'left' && hasText && (
        <div className="toggle-switch-content">
          {label && <span className="toggle-switch-label">{label}</span>}
          {description && <span className="toggle-switch-desc">{description}</span>}
        </div>
      )}

      <span className={`toggle-switch-pill toggle-switch-pill--${size}`}>
        <input
          type="checkbox"
          role="switch"
          id={switchId}
          name={name}
          checked={Boolean(checked)}
          disabled={disabled}
          aria-checked={Boolean(checked)}
          aria-label={ariaLabel || (typeof label === 'string' ? label : undefined)}
          onChange={handleChange}
          className="toggle-switch-input"
        />
        <span className="toggle-switch-track" aria-hidden="true">
          <span className="toggle-switch-thumb">
            <span className="toggle-switch-thumb-glow" />
          </span>
        </span>
      </span>

      {labelPosition === 'right' && hasText && (
        <div className="toggle-switch-content">
          {label && <span className="toggle-switch-label">{label}</span>}
          {description && <span className="toggle-switch-desc">{description}</span>}
        </div>
      )}
    </label>
  );
}
