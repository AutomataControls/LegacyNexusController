import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import Switch from '../components/Switch';
import { authenticatedFetch } from '../services/api';

interface BoardStatus {
  megabas: boolean;
  relay16: boolean;
  relay8: boolean;
  input16: boolean;
}

interface RelayState {
  id: number;
  state: boolean;
  mode: 'manual' | 'auto';
}

interface AnalogOutput {
  id: number;
  value: number;
  mode: 'manual' | 'auto';
}

interface UniversalInput {
  id: number;
  value: number;
  type: '0-10V' | '1k' | '10k';
  label: string;
  conversionType?: 'temperature' | 'humidity' | 'pressure' | 'voltage' | 'resistance' | 'raw';
}

const Controls: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('megabas');
  const [boards, setBoards] = useState<BoardStatus>({
    megabas: false,
    relay16: false,
    relay8: false,
    input16: false
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [boardConfigs, setBoardConfigs] = useState<any[]>([]);
  
  // MegaBAS states
  const [triacs, setTriacs] = useState<RelayState[]>([
    { id: 1, state: false, mode: 'auto' },
    { id: 2, state: false, mode: 'auto' },
    { id: 3, state: false, mode: 'auto' },
    { id: 4, state: false, mode: 'auto' }
  ]);
  
  const [analogOutputs, setAnalogOutputs] = useState<AnalogOutput[]>([
    { id: 1, value: 0, mode: 'auto' },
    { id: 2, value: 0, mode: 'auto' },
    { id: 3, value: 0, mode: 'auto' },
    { id: 4, value: 0, mode: 'auto' }
  ]);
  
  const [universalInputs, setUniversalInputs] = useState<UniversalInput[]>([]);
  const [inputs16, setInputs16] = useState<UniversalInput[]>([]);
  const [relays16, setRelays16] = useState<RelayState[]>([]);
  const [relays8, setRelays8] = useState<RelayState[]>([]);
  
  // Detect connected boards on component mount
  useEffect(() => {
    detectBoards();
    const interval = setInterval(fetchBoardStates, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Conversion function for sensor values
  const convertValue = (rawValue: number, conversionType?: string): { converted: string; unit: string } => {
    if (!conversionType || conversionType === 'raw') {
      return { converted: rawValue.toFixed(0), unit: '' };
    }
    
    switch (conversionType) {
      case 'temperature':
        // Check if this is a 1k RTD or 10k thermistor based on the value range
        // rawValue is resistance in ohms
        if (rawValue < 2000) {
          // BALCO 1000Ω temperature sensor
          // Formula from Schneider Electric spec sheet:
          // Temperature = (SQRT((0.00644 × R) - 1.6597) - 1.961) / 0.00322
          const tempF = (Math.sqrt((0.00644 * rawValue) - 1.6597) - 1.961) / 0.00322;
          const clampedTemp = Math.max(-40, Math.min(250, tempF));
          return { converted: clampedTemp.toFixed(1), unit: '°F' };
        } else {
          // 10k thermistor
          const tempC = 1 / (Math.log(rawValue / 10000) / 3950 + 1 / 298.15) - 273.15;
          const tempF = tempC * 9/5 + 32;
          return { converted: tempF.toFixed(1), unit: '°F' };
        }
      
      case 'humidity':
        // Convert to humidity percentage (you'll need to adjust this based on your sensor)
        const humidity = (rawValue / 10000) * 100;
        return { converted: humidity.toFixed(1), unit: '%' };
      
      case 'pressure':
        // Convert to PSI (adjust based on your pressure sensor specs)
        const pressure = (rawValue / 1000) * 15; // Example conversion
        return { converted: pressure.toFixed(1), unit: 'PSI' };
      
      case 'voltage':
        // Direct voltage reading
        return { converted: (rawValue / 1000).toFixed(2), unit: 'V' };
      
      case 'resistance':
        return { converted: rawValue.toFixed(0), unit: 'Ω' };
      
      default:
        return { converted: rawValue.toFixed(0), unit: '' };
    }
  };

  const detectBoards = async () => {
    try {
      const response = await authenticatedFetch('/api/boards/detect');
      if (response.ok) {
        const data = await response.json();
        setBoards(data);
        
        // Set first available tab as active
        if (data.megabas) setActiveTab('megabas');
        else if (data.input16) setActiveTab('input16');
        else if (data.relay16) setActiveTab('relay16');
        else if (data.relay8) setActiveTab('relay8');
        else setActiveTab('megabas'); // Default to megabas tab
      }
      
      // Also fetch board configurations
      const configResponse = await authenticatedFetch('/api/logic/boards');
      if (configResponse.ok) {
        const configs = await configResponse.json();
        setBoardConfigs(configs);
      }
      
      setLoading(false);
    } catch (err) {
      setError('Failed to detect boards');
      setLoading(false);
    }
  };

  const fetchBoardStates = async () => {
    try {
      const response = await authenticatedFetch('/api/boards/states');
      if (response.ok) {
        const data = await response.json();
        
        if (data.megabas) {
          setTriacs(data.megabas.triacs || triacs);
          setAnalogOutputs(data.megabas.analogOutputs || analogOutputs);
          setUniversalInputs(data.megabas.inputs || []);
        }
        if (data.input16) {
          setInputs16(data.input16.inputs || []);
        }
        if (data.relay16) {
          setRelays16(data.relay16.relays || []);
        }
        if (data.relay8) {
          setRelays8(data.relay8.relays || []);
        }
      }
    } catch (err) {
      console.error('Failed to fetch board states:', err);
    }
  };

  const toggleRelay = async (board: string, relayId: number, state: boolean) => {
    try {
      const response = await authenticatedFetch('/api/boards/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, relayId, state })
      });
      
      if (response.ok) {
        // Update local state
        if (board === 'megabas') {
          setTriacs(prev => prev.map(t => 
            t.id === relayId ? { ...t, state } : t
          ));
        } else if (board === 'relay16') {
          setRelays16(prev => prev.map(r => 
            r.id === relayId ? { ...r, state } : r
          ));
        } else if (board === 'relay8') {
          setRelays8(prev => prev.map(r => 
            r.id === relayId ? { ...r, state } : r
          ));
        }
      }
    } catch (err) {
      console.error('Failed to toggle relay:', err);
    }
  };

  const toggleMode = async (board: string, outputId: number, mode: 'manual' | 'auto') => {
    try {
      const response = await authenticatedFetch('/api/boards/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board, outputId, mode })
      });
      
      if (response.ok) {
        // Update local state based on board type
        if (board === 'megabas-triac') {
          setTriacs(prev => prev.map(t => 
            t.id === outputId ? { ...t, mode } : t
          ));
        } else if (board === 'megabas-analog') {
          setAnalogOutputs(prev => prev.map(a => 
            a.id === outputId ? { ...a, mode } : a
          ));
        } else if (board === 'relay16') {
          setRelays16(prev => prev.map(r => 
            r.id === outputId ? { ...r, mode } : r
          ));
        } else if (board === 'relay8') {
          setRelays8(prev => prev.map(r => 
            r.id === outputId ? { ...r, mode } : r
          ));
        }
      }
    } catch (err) {
      console.error('Failed to toggle mode:', err);
    }
  };

  const updateAnalogOutput = async (outputId: number, value: number) => {
    try {
      const response = await authenticatedFetch('/api/boards/analog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ board: 'megabas', outputId, value })
      });
      
      if (response.ok) {
        setAnalogOutputs(prev => prev.map(a => 
          a.id === outputId ? { ...a, value } : a
        ));
      }
    } catch (err) {
      console.error('Failed to update analog output:', err);
    }
  };


  const renderMegaBASTab = () => {
    // Find the MegaBAS board config
    const megabasConfig = boardConfigs.find(c => c.boardType === 'megabas' && c.enabled);
    
    return (
      <div className="controls-tab-content">
        <div className="controls-section">
          <h3>Triac Outputs</h3>
          <div className="outputs-grid">
            {triacs.map(triac => {
              const triacConfig = megabasConfig?.outputs?.[`triac${triac.id}`];
              const triacName = triacConfig?.name || `Triac ${triac.id}`;
              
              return (
                <div key={triac.id} className="output-card">
                  <div className="output-header">
                    <span>{triacName}</span>
                    <button 
                      className={`mode-toggle ${triac.mode}`}
                      onClick={() => toggleMode('megabas-triac', triac.id, triac.mode === 'auto' ? 'manual' : 'auto')}
                    >
                      {triac.mode === 'auto' ? 'AUTO' : 'MANUAL'}
                    </button>
                  </div>
                  <Switch
                    checked={triac.state}
                    onCheckedChange={(checked) => triac.mode === 'manual' && toggleRelay('megabas', triac.id, checked)}
                    disabled={triac.mode === 'auto'}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="controls-section">
          <h3>Analog Outputs (0-10V)</h3>
          <div className="outputs-grid">
            {analogOutputs.map(output => {
              const aoConfig = megabasConfig?.outputs?.[`ao${output.id}`];
              const aoName = aoConfig?.name || `AO ${output.id}`;
              
              return (
                <div key={output.id} className="output-card">
                  <div className="output-header">
                    <span>{aoName}</span>
                    <button 
                      className={`mode-toggle ${output.mode}`}
                      onClick={() => toggleMode('megabas-analog', output.id, output.mode === 'auto' ? 'manual' : 'auto')}
                    >
                      {output.mode === 'auto' ? 'AUTO' : 'MANUAL'}
                    </button>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.1"
                    value={output.value}
                    onChange={(e) => output.mode === 'manual' && updateAnalogOutput(output.id, parseFloat(e.target.value))}
                    disabled={output.mode === 'auto'}
                    className={output.mode}
                  />
                  <span className="output-value">{output.value.toFixed(1)}V</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="controls-section">
          <h3>Universal Inputs</h3>
          <div className="inputs-grid">
            {universalInputs.map(input => {
              const inputConfig = megabasConfig?.inputs?.[input.id];
              const conversionType = inputConfig?.conversionType || 'raw';
              const { converted, unit } = convertValue(input.value, conversionType);
              
              return (
                <div key={input.id} className="input-card">
                  <div className="input-header">
                    <span>{inputConfig?.name || input.label || `Input ${input.id}`}</span>
                    <span className="input-type">{conversionType}</span>
                  </div>
                  <div className="input-values">
                    <div className="input-value-converted">
                      {converted}{unit}
                    </div>
                    <div className="input-value-raw">
                      {input.value.toFixed(0)} raw
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const render16InputTab = () => (
    <div className="controls-tab-content">
      <div className="controls-section">
        <h3>16 Universal Inputs</h3>
        <div className="inputs-grid large">
          {inputs16.map(input => {
            // Find the board config for this input
            const input16Config = boardConfigs.find(c => c.boardType === '16univin' && c.enabled);
            const inputConfig = input16Config?.inputs?.[input.id];
            const conversionType = inputConfig?.conversionType || 'raw';
            const { converted, unit } = convertValue(input.value, conversionType);
            
            return (
              <div key={input.id} className="input-card">
                <div className="input-header">
                  <span>{inputConfig?.name || input.label || `Input ${input.id}`}</span>
                  <span className="input-type">{conversionType}</span>
                </div>
                <div className="input-values">
                  <div className="input-value-converted">
                    {converted}{unit}
                  </div>
                  <div className="input-value-raw">
                    {input.value.toFixed(0)} raw
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const render16RelayTab = () => (
    <div className="controls-tab-content">
      <div className="controls-section">
        <h3>16 Relay Outputs</h3>
        <div className="outputs-grid large">
          {relays16.map(relay => {
            // Find the board config for this relay
            const relay16Config = boardConfigs.find(c => c.boardType === '16relay' && c.enabled);
            const relayConfig = relay16Config?.outputs?.[relay.id];
            const relayName = relayConfig?.name || `Relay ${relay.id}`;
            
            return (
              <div key={relay.id} className="output-card">
                <div className="output-header">
                  <span>{relayName}</span>
                  <button 
                    className={`mode-toggle ${relay.mode}`}
                    onClick={() => toggleMode('relay16', relay.id, relay.mode === 'auto' ? 'manual' : 'auto')}
                  >
                    {relay.mode === 'auto' ? 'AUTO' : 'MANUAL'}
                  </button>
                </div>
                <Switch
                  checked={relay.state}
                  onCheckedChange={(checked) => relay.mode === 'manual' && toggleRelay('relay16', relay.id, checked)}
                  disabled={relay.mode === 'auto'}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const render8RelayTab = () => (
    <div className="controls-tab-content">
      <div className="controls-section">
        <h3>8 Relay Outputs</h3>
        <div className="outputs-grid">
          {relays8.map(relay => (
            <div key={relay.id} className="output-card">
              <div className="output-header">
                <span>Relay {relay.id}</span>
                <button 
                  className={`mode-toggle ${relay.mode}`}
                  onClick={() => toggleMode('relay8', relay.id, relay.mode === 'auto' ? 'manual' : 'auto')}
                >
                  {relay.mode === 'auto' ? 'AUTO' : 'MANUAL'}
                </button>
              </div>
              <Switch
                checked={relay.state}
                onCheckedChange={(checked) => relay.mode === 'manual' && toggleRelay('relay8', relay.id, checked)}
                disabled={relay.mode === 'auto'}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <div className="controls-loading">Detecting boards...</div>;
  }

  if (error) {
    return <div className="controls-error"><AlertCircle /> {error}</div>;
  }

  return (
    <div className="controls-container">
      <div className="controls-header">
        <h1>Manual I/O Controls</h1>
        <div className="board-status">
          {boards.megabas && <span className="board-chip">MegaBAS</span>}
          {boards.input16 && <span className="board-chip">16-Input</span>}
          {boards.relay16 && <span className="board-chip">16-Relay</span>}
          {boards.relay8 && <span className="board-chip">8-Relay</span>}
        </div>
      </div>

      <div className="controls-tabs">
        {boards.megabas && (
          <button
            className={`tab-button ${activeTab === 'megabas' ? 'active' : ''}`}
            onClick={() => setActiveTab('megabas')}
          >
            MegaBAS
          </button>
        )}
        {boards.input16 && (
          <button
            className={`tab-button ${activeTab === 'input16' ? 'active' : ''}`}
            onClick={() => setActiveTab('input16')}
          >
            16 Inputs
          </button>
        )}
        {boards.relay16 && (
          <button
            className={`tab-button ${activeTab === 'relay16' ? 'active' : ''}`}
            onClick={() => setActiveTab('relay16')}
          >
            16 Relays
          </button>
        )}
        {boards.relay8 && (
          <button
            className={`tab-button ${activeTab === 'relay8' ? 'active' : ''}`}
            onClick={() => setActiveTab('relay8')}
          >
            8 Relays
          </button>
        )}
      </div>

      <div className="controls-content">
        {activeTab === 'megabas' && boards.megabas && renderMegaBASTab()}
        {activeTab === 'input16' && boards.input16 && render16InputTab()}
        {activeTab === 'relay16' && boards.relay16 && render16RelayTab()}
        {activeTab === 'relay8' && boards.relay8 && render8RelayTab()}
      </div>
    </div>
  );
};

export default Controls;