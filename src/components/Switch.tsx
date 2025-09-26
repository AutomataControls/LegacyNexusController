import React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import '../styles/switch.css';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const Switch: React.FC<SwitchProps> = ({ 
  checked, 
  onCheckedChange, 
  disabled = false,
  className = ''
}) => {
  return (
    <SwitchPrimitive.Root
      className={`switch-root ${className}`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <SwitchPrimitive.Thumb className="switch-thumb" />
    </SwitchPrimitive.Root>
  );
};

export default Switch;