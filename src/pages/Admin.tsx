import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, FileText, Lock, AlertTriangle, Upload, 
  Play, Square, Wifi, WifiOff, CheckCircle, 
  XCircle, Settings, Activity, Server, FileCode, Cpu
} from 'lucide-react';
import Switch from '../components/Switch';
import AuthGuard from '../components/AuthGuard';
import { authenticatedFetch } from '../services/api';
import { usePersistedState, useSessionTimeout } from '../hooks/usePersistedState';
import '../styles/admin.css';

interface AuditLog {
  id: number;
  timestamp: string;
  user_id: number;
  username: string;
  action: string;
  resource: string;
  ip_address: string;
  user_agent: string;
  status: string;
  details?: string;
}

interface BoardOutput {
  name: string;
  type: string;
  enabled: boolean;
}

interface BoardInput {
  name: string;
  inputType: '0-10V' | '1k' | '10k';
  conversionType: 'temperature' | 'humidity' | 'pressure' | 'voltage' | 'resistance' | 'amps' | 'current';
  enabled: boolean;
  scaling?: string;
}

interface BoardConfig {
  boardType: 'megabas' | '16univin' | '16relind' | '16uout' | '8relind';
  stackAddress: number;  // Stack address for this board type (0, 1, 2, etc.)
  enabled: boolean;
  outputs: {
    [key: number]: BoardOutput;
  };
  inputs?: {
    [key: number]: BoardInput;
  };
}

interface BMSStatus {
  connected: boolean;
  lastPing: string;
  latency: number;
  usingLocalFile: boolean;
  logicFileStatus: 'remote' | 'local' | 'none';
}

const Admin: React.FC = () => {
  // Use persisted state for tab selection and equipment
  const [activeTab, setActiveTab] = usePersistedState<'audit' | 'security' | 'logic' | 'boards' | 'status' | 'pid'>('adminActiveTab', 'logic', 'admin');
  const [selectedEquipment, setSelectedEquipment] = usePersistedState('adminSelectedEquipment', '', 'admin');
  const [logicEnabled, setLogicEnabled] = usePersistedState('adminLogicEnabled', false, 'admin');
  const [autoRunEnabled, setAutoRunEnabled] = usePersistedState('adminAutoRunEnabled', false, 'admin');
  const [pollingInterval, setPollingInterval] = usePersistedState('adminPollingInterval', 7, 'admin');
  
  // Regular state for non-persistent data
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [timeRange, setTimeRange] = useState<number>(24);
  
  // Audit and session hooks
  // const { logAudit } = useAuditLog(); // Available for audit logging
  useSessionTimeout(); // Auto-manages 15-minute timeout for admin users
  
  // Logic Engine states
  const [logicFile, setLogicFile] = useState<File | null>(null);
  const [logicContent, setLogicContent] = useState<string>('');
  const [logicRunning, setLogicRunning] = useState(false);
  const [logicOutput, setLogicOutput] = useState<string>('');
  const [equipmentList, setEquipmentList] = useState<Array<{id: string, name: string, hasLogic: boolean, fromFile?: boolean}>>([]);
  const [configChanged, setConfigChanged] = useState(false);
  const [isEditingLogic, setIsEditingLogic] = useState(false);
  const [originalLogicContent, setOriginalLogicContent] = useState<string>('');
  const [logicResults, setLogicResults] = useState<any[]>([]);
  const [executionResults, setExecutionResults] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const executionResultsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Hardware Configuration HTML states
  const [configHtmlFile, setConfigHtmlFile] = useState<File | null>(null);
  const [parsedHardwareConfig, setParsedHardwareConfig] = useState<{
    projectInfo: any;
    megabasInputs: any[];
    megabasTriacs: any[];
    megabasAnalogOutputs: any[];
    input16Channels: any[];
    relay16Channels: any[];
    systemComponents: string[];
    sensorSpecs: any;
    equipmentIds?: string[];
  } | null>(null);
  const [showConfigPreview, setShowConfigPreview] = useState(false);
  const configFileInputRef = useRef<HTMLInputElement>(null);
  
  // Board Configuration states - will be populated based on detected boards
  const [boardConfigs, setBoardConfigs] = useState<BoardConfig[]>([]);
  
  // BMS Status states
  const [bmsStatus, setBmsStatus] = useState<BMSStatus>({
    connected: false,
    lastPing: 'Never',
    latency: 0,
    usingLocalFile: false,
    logicFileStatus: 'none'
  });
  const [bmsEnabled, setBmsEnabled] = useState(false);
  const [nodeRedIntegrationEnabled, setNodeRedIntegrationEnabled] = usePersistedState('nodeRedIntegrationEnabled', false, 'admin');
  
  // PID Controller states - will be automatically configured based on uploaded config
  const [pidControllers, setPidControllers] = useState<any[]>([]);

  useEffect(() => {
    checkUserRole();
    if (activeTab === 'audit') {
      fetchAuditLogs();
    } else if (activeTab === 'boards') {
      fetchBoardConfigs();
    } else if (activeTab === 'status') {
      fetchBMSStatus();
      const interval = setInterval(fetchBMSStatus, 20000); // Check every 20 seconds to reduce load
      return () => clearInterval(interval);
    } else if (activeTab === 'logic') {
      fetchEquipmentList();
      fetchSavedBoardConfig(); // Load saved board config
      // Always try to fetch logic if equipment is selected
      if (selectedEquipment) {
        fetchCurrentLogic();
      } else {
        // If no equipment selected but there are saved ones, select the first
        fetchEquipmentList().then(() => {
          // This will be handled in fetchEquipmentList
        });
      }
    } else if (activeTab === 'pid') {
      fetchPIDControllers();
    }
    return () => {}; // Add cleanup return
  }, [activeTab, timeRange]);

  // Poll for logic results when auto-run is enabled
  useEffect(() => {
    if (autoRunEnabled && selectedEquipment) {
      // Fetch immediately
      fetchLogicResults();
      
      // Set up polling interval (every 10 seconds to reduce load)
      resultsIntervalRef.current = setInterval(fetchLogicResults, 10000);
      
      return () => {
        if (resultsIntervalRef.current) {
          clearInterval(resultsIntervalRef.current);
          resultsIntervalRef.current = null;
        }
      };
    } else {
      // Clear results when auto-run is disabled
      setLogicResults([]);
      if (resultsIntervalRef.current) {
        clearInterval(resultsIntervalRef.current);
        resultsIntervalRef.current = null;
      }
      return () => {}; // Add return statement for this branch
    }
  }, [autoRunEnabled, selectedEquipment]);

  // Poll for execution results from background service
  useEffect(() => {
    if (activeTab === 'logic' && logicContent && logicContent.includes('processCoolingTowerControl')) {
      // Fetch immediately
      fetchExecutionResults();
      
      // Set up polling interval (every 15 seconds to reduce load)
      executionResultsIntervalRef.current = setInterval(fetchExecutionResults, 15000);
      
      return () => {
        if (executionResultsIntervalRef.current) {
          clearInterval(executionResultsIntervalRef.current);
          executionResultsIntervalRef.current = null;
        }
      };
    }
    return () => {};
  }, [activeTab, logicContent]);

  const checkUserRole = () => {
    const token = sessionStorage.getItem('authToken');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setIsAdmin(payload.role === 'admin');
      } catch (error) {
        console.error('Error parsing token:', error);
        setIsAdmin(false);
      }
    }
  };

  const fetchAuditLogs = async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(`/api/audit/logs?hours=${timeRange}`);
      if (response.ok) {
        const data = await response.json();
        setAuditLogs(data);
      }
    } catch (error) {
      console.error('Error fetching audit logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSavedBoardConfig = async () => {
    try {
      const response = await authenticatedFetch('/api/logic/boards');
      if (response.ok) {
        const savedConfigs = await response.json();
        if (savedConfigs && savedConfigs.length > 0) {
          // Reconstruct the parsed config from saved board configs
          const reconstructedConfig: any = {
            megabasInputs: [],
            megabasTriacs: [],
            megabasAnalogOutputs: [],
            input16Channels: [],
            relay16Channels: [],
            systemComponents: [],
            sensorSpecs: {}
          };
          
          savedConfigs.forEach((board: BoardConfig) => {
            if (board.boardType === 'megabas') {
              // Extract MegaBAS configurations
              if (board.outputs) {
                Object.entries(board.outputs).forEach(([key, output]) => {
                  const channel = parseInt(key);
                  if (output.type === 'triac') {
                    reconstructedConfig.megabasTriacs.push({
                      channel,
                      name: output.name,
                      type: '24VAC Triac'
                    });
                  } else if (output.type === '0-10V' && channel > 4) {
                    reconstructedConfig.megabasAnalogOutputs.push({
                      channel: channel - 4,
                      name: output.name,
                      type: '0-10V',
                      range: '0-10V'
                    });
                  }
                });
              }
              if (board.inputs) {
                Object.entries(board.inputs).forEach(([key, input]) => {
                  reconstructedConfig.megabasInputs.push({
                    channel: parseInt(key),
                    name: input.name,
                    type: '0-10V',
                    conversion: input.conversionType,
                    range: (input as any).scaling ? `0-${(input as any).scaling.split('-')[1]}A` : '0-10V',
                    scaling: (input as any).scaling
                  });
                });
              }
            } else if (board.boardType === '16univin' && board.inputs) {
              Object.entries(board.inputs).forEach(([key, input]) => {
                reconstructedConfig.input16Channels.push({
                  channel: parseInt(key),
                  name: input.name,
                  type: input.inputType,
                  conversion: input.conversionType,
                  range: input.inputType,
                  scaling: (input as any).scaling
                });
              });
            } else if (board.boardType === '16relind' && board.outputs) {
              Object.entries(board.outputs).forEach(([key, output]) => {
                reconstructedConfig.relay16Channels.push({
                  channel: parseInt(key),
                  name: output.name,
                  type: 'relay'
                });
              });
            }
          });
          
          setParsedHardwareConfig(reconstructedConfig);
          console.log('Loaded saved board configuration');
        }
      }
    } catch (error) {
      console.error('Error fetching saved board config:', error);
    }
  };

  const fetchBoardConfigs = async () => {
    try {
      // Try to load saved configurations FIRST
      const configResponse = await authenticatedFetch('/api/logic/boards');
      if (configResponse.ok) {
        const savedConfigs = await configResponse.json();
        if (savedConfigs && savedConfigs.length > 0) {
          // Use the saved configs directly - they have all the input/output configs
          setBoardConfigs(savedConfigs);
          console.log('Loaded saved board configurations:', savedConfigs);
          return; // Don't detect boards if we have saved config
        }
      }
      
      // Only detect boards if no saved config exists
      const detectResponse = await authenticatedFetch('/api/boards/detect');
      if (detectResponse.ok) {
        const detectedBoards = await detectResponse.json();
        const configs: BoardConfig[] = [];
        
        // Add detected MegaBAS boards (usually just one at stack 0)
        if (detectedBoards.megabas) {
          configs.push({
            boardType: 'megabas',
            stackAddress: 0,
            enabled: true,
            outputs: {},
            inputs: {}
          });
        }
        
        // Add detected 16-Input boards
        if (detectedBoards.input16) {
          configs.push({
            boardType: '16univin',
            stackAddress: 0,
            enabled: true,
            outputs: {},
            inputs: {}
          });
        }
        
        // Add detected 16-Relay boards
        if (detectedBoards.relay16) {
          configs.push({
            boardType: '16relind',
            stackAddress: 0,
            enabled: true,
            outputs: {}
          });
        }
        
        // Add detected 8-Relay boards
        if (detectedBoards.relay8) {
          configs.push({
            boardType: '8relind',
            stackAddress: 0,
            enabled: true,
            outputs: {}
          });
        }
        
        setBoardConfigs(configs);
      }
    } catch (error) {
      console.error('Error fetching board configs:', error);
    }
  };

  const fetchBMSStatus = async () => {
    try {
      const response = await authenticatedFetch('/api/logic/bms-status');
      if (response.ok) {
        const data = await response.json();
        setBmsStatus(data);
        setBmsEnabled(data.enabled || false);
      }
    } catch (error) {
      console.error('Error fetching BMS status:', error);
    }
  };

  const fetchPIDControllers = async () => {
    try {
      const response = await authenticatedFetch('/api/pid-controllers');
      if (response.ok) {
        const data = await response.json();
        setPidControllers(data || []);
      } else {
        console.error('Failed to fetch PID controllers');
        setPidControllers([]);
      }
    } catch (error) {
      console.error('Error fetching PID controllers:', error);
      setPidControllers([]);
    }
  };

  const fetchEquipmentList = async () => {
    try {
      const response = await authenticatedFetch('/api/logic/equipment-list');
      if (response.ok) {
        const data = await response.json();
        setEquipmentList(data);
        
        // Auto-select first equipment with logic if none selected
        if (!selectedEquipment && data.length > 0) {
          const firstWithLogic = data.find((eq: any) => eq.hasLogic);
          if (firstWithLogic) {
            setSelectedEquipment(firstWithLogic.id);
            // Fetch the logic for this equipment
            const logicResponse = await authenticatedFetch(`/api/logic/current/${firstWithLogic.id}`);
            if (logicResponse.ok) {
              const logicData = await logicResponse.text();
              setLogicContent(logicData);
              setOriginalLogicContent(logicData);
              setIsEditingLogic(false);
              
              // Also fetch config
              const configResponse = await authenticatedFetch(`/api/logic/config/${firstWithLogic.id}`);
              if (configResponse.ok) {
                const config = await configResponse.json();
                setLogicEnabled(config.enabled || false);
                setAutoRunEnabled(config.autoRunEnabled || false);
                setPollingInterval(config.pollingInterval || 7);
                setConfigChanged(false);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error fetching equipment list:', error);
    }
  };
  
  const parseHardwareConfigFromHTML = (htmlContent: string) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      
      const config: {
        projectInfo: any;
        megabasInputs: any[];
        megabasTriacs: any[];
        megabasAnalogOutputs: any[];
        input16Channels: any[];
        relay16Channels: any[];
        systemComponents: string[];
        sensorSpecs: any;
        equipmentIds?: string[];
      } = {
        projectInfo: {},
        megabasInputs: [],
        megabasTriacs: [],
        megabasAnalogOutputs: [],
        input16Channels: [],
        relay16Channels: [],
        systemComponents: [],
        sensorSpecs: {},
        equipmentIds: []
      };
      
      // Extract project information
      const headerText = doc.querySelector('.header')?.textContent || '';
      const projectMatch = headerText.match(/Project:\s*([^|]+)/);
      const dateMatch = headerText.match(/Date:\s*([^|]+)/);
      const contractorMatch = headerText.match(/Contractor:\s*([^|]+)/);
      
      config.projectInfo = {
        project: projectMatch ? projectMatch[1].trim() : '',
        date: dateMatch ? dateMatch[1].trim() : '',
        contractor: contractorMatch ? contractorMatch[1].trim() : ''
      };
      
      // Parse tables - Equipment IDs first, then I/O assignments
      const ioTables = doc.querySelectorAll('.io-table');
      console.log(`Found ${ioTables.length} I/O tables in HTML`);
      
      ioTables.forEach((table, tableIndex) => {
        const rows = table.querySelectorAll('tr');
        const headerRow = rows[0];
        const headerText = headerRow?.textContent || '';
        console.log(`Table ${tableIndex}: Headers = ${headerText}`);
        
        // Check if this is the Equipment Identification table
        if (headerText.includes('Equipment ID')) {
          rows.forEach((row, index) => {
            if (index === 0) return; // Skip header
            
            const cells = row.querySelectorAll('td');
            if (cells.length >= 2) {
              const equipmentName = cells[0]?.textContent?.trim();
              const equipmentId = cells[1]?.textContent?.trim();
              
              if (equipmentId && equipmentId.length === 20) { // Standard equipment ID length
                config.equipmentIds?.push(equipmentId);
                console.log(`Found equipment: ${equipmentName} - ${equipmentId}`);
              }
            }
          });
          return; // Skip further processing for this table
        }
        
        // Check if this is a table with specific board headers
        const hasBAUHeader = headerText.includes('BAU') || headerText.includes('Building Automation');
        const has16InputHeader = headerText.includes('16Input') || headerText.includes('16 Input');
        const has16RelayHeader = headerText.includes('16Relay') || headerText.includes('16 Relay');
        
        console.log(`Processing table - BAU: ${hasBAUHeader}, 16Input: ${has16InputHeader}, 16Relay: ${has16RelayHeader}`);
        
        // Process I/O Assignment tables
        rows.forEach((row, index) => {
          if (index === 0) return; // Skip header
          
          const cells = row.querySelectorAll('td');
          
          // Determine column layout based on number of cells
          // Could be 6-column (BAU, Function, 16Input, Function, 16Relay, Function)
          // Or 4-column (Channel, Function, Channel, Function)
          // Or 2-column (Channel, Function)
          
          if (cells.length >= 6) {
            // Handle 6-column format
            // Building Automation HAT assignments (columns 0-1)
            const bauChannel = cells[0]?.textContent?.trim();
            const bauFunction = cells[1]?.textContent?.trim();
            
            if (bauChannel && bauFunction && bauChannel !== '' && bauFunction !== '') {
              if (bauChannel.match(/T\d+-T\d+|T\d+/)) {
                // Handle T1-T3 format
                const matches = bauChannel.match(/T(\d+)(?:-T(\d+))?/);
                if (matches) {
                  const start = parseInt(matches[1]);
                  const end = matches[2] ? parseInt(matches[2]) : start;
                  for (let i = start; i <= end; i++) {
                    config.megabasTriacs.push({
                      channel: i,
                      name: bauFunction,
                      type: '24VAC Triac'
                    });
                  }
                }
              } else if (bauChannel.match(/AO\d+(?:-AO\d+)?/)) {
                // Handle AO1-AO3 format
                const matches = bauChannel.match(/AO(\d+)(?:-AO(\d+))?/);
                if (matches) {
                  const start = parseInt(matches[1]);
                  const end = matches[2] ? parseInt(matches[2]) : start;
                  for (let i = start; i <= end; i++) {
                    config.megabasAnalogOutputs.push({
                      channel: i,
                      name: bauFunction.includes('Speed') ? `VFD ${i} Speed` : bauFunction,
                      type: '0-10V',
                      range: '0-10V'
                    });
                  }
                }
              } else if (bauChannel.match(/AI\d+(?:-AI\d+)?/)) {
                // Handle AI1-AI6 format
                const matches = bauChannel.match(/AI(\d+)(?:-AI(\d+))?/);
                if (matches) {
                  const start = parseInt(matches[1]);
                  const end = matches[2] ? parseInt(matches[2]) : start;
                  for (let i = start; i <= end; i++) {
                    const isCurrentSensor = bauFunction.includes('Current') || bauFunction.includes('0-50A');
                    const inputName = bauFunction.includes('VFD') ? bauFunction : `VFD Current ${i}`;
                    config.megabasInputs.push({
                      channel: i,
                      name: inputName,
                      type: '0-10V',
                      conversion: isCurrentSensor ? 'amps' : 'voltage',
                      range: bauFunction.includes('0-50A') ? '0-50A' : '0-10V',
                      scaling: isCurrentSensor ? '0-50' : undefined
                    });
                    console.log(`Added MegaBAS AI${i}: ${inputName} (${isCurrentSensor ? 'current sensor 0-50A' : '0-10V voltage'})`);
                  }
                }
              }
            }
            
            // 16 Input HAT assignments (columns 2-3)
            const inputChannel = cells[2]?.textContent?.trim();
            const inputFunction = cells[3]?.textContent?.trim();
            
            if (inputChannel && inputFunction && inputChannel !== '') {
              // Handle both CH format and just number format
              let chMatch = inputChannel.match(/CH(\d+)(?:-CH(\d+))?/);
              if (!chMatch) {
                // Try plain number format
                chMatch = inputChannel.match(/(\d+)(?:-(\d+))?/);
              }
              
              if (chMatch) {
                const start = parseInt(chMatch[1]);
                const end = chMatch[2] ? parseInt(chMatch[2]) : start;
                for (let i = start; i <= end; i++) {
                  let sensorType = '0-10V';
                  let conversionType = 'voltage';
                  
                  // Determine sensor type from function description
                  let scaling = undefined;
                  if (inputFunction.includes('RTD') || inputFunction.includes('Temp') || inputFunction.includes('Temperature')) {
                    sensorType = '1k';
                    conversionType = 'temperature';
                  } else if (inputFunction.includes('Current') || inputFunction.includes('Amps')) {
                    sensorType = '0-10V';
                    conversionType = 'amps';
                    // Extract scaling
                    if (inputFunction.includes('0-50A')) {
                      scaling = '0-50';
                    } else if (inputFunction.includes('0-20A')) {
                      scaling = '0-20';
                    } else if (inputFunction.includes('0-100A')) {
                      scaling = '0-100';
                    } else {
                      scaling = '0-50'; // Default
                    }
                  } else if (inputFunction.includes('Pressure')) {
                    sensorType = '0-10V';
                    conversionType = 'pressure';
                  }
                  
                  const inputConfig: any = {
                    channel: i,
                    name: inputFunction,
                    type: sensorType,
                    conversion: conversionType,
                    range: sensorType
                  };
                  
                  if (scaling) {
                    inputConfig.scaling = scaling;
                  }
                  
                  config.input16Channels.push(inputConfig);
                  console.log(`Added 16-Input CH${i}: ${inputFunction} (${sensorType}/${conversionType})`);
                }
              }
            }
            
            // 16 Relay HAT assignments (columns 4-5)
            const relayChannel = cells[4]?.textContent?.trim();
            const relayFunction = cells[5]?.textContent?.trim();
            
            if (relayChannel && relayFunction) {
              const chMatch = relayChannel.match(/CH(\d+)(?:-(\d+))?/);
              if (chMatch) {
                const start = parseInt(chMatch[1]);
                const end = chMatch[2] ? parseInt(chMatch[2]) : start;
                for (let i = start; i <= end; i++) {
                  config.relay16Channels.push({
                    channel: i,
                    name: relayFunction,
                    type: 'relay'
                  });
                }
              }
            }
          } else if (cells.length === 4) {
            // 4-column format: could be (BAU Channel, Function, 16Input Channel, Function)
            // Or (16Input Channel, Function, 16Relay Channel, Function)
            const col1Channel = cells[0]?.textContent?.trim();
            const col1Function = cells[1]?.textContent?.trim();
            const col2Channel = cells[2]?.textContent?.trim();
            const col2Function = cells[3]?.textContent?.trim();
            
            // Process first pair
            if (col1Channel && col1Function && col1Channel !== '') {
              // Determine type based on channel format
              if (col1Channel.match(/T\d+|AO\d+|AI\d+/)) {
                // MegaBAS channel
                const bauChannel = col1Channel;
                const bauFunction = col1Function;
            
            if (bauChannel && bauFunction) {
              if (bauChannel.startsWith('T')) {
                // Triac outputs
                const triacNum = bauChannel.replace('T', '').split('-');
                triacNum.forEach(num => {
                  if (num.trim()) {
                    config.megabasTriacs.push({
                      channel: parseInt(num.trim()),
                      name: bauFunction,
                      type: '24VAC Triac'
                    });
                  }
                });
              } else if (bauChannel.startsWith('AO')) {
                // Analog outputs
                const aoMatch = bauChannel.match(/AO(\d+)(?:-AO(\d+))?/);
                if (aoMatch) {
                  const start = parseInt(aoMatch[1]);
                  const end = aoMatch[2] ? parseInt(aoMatch[2]) : start;
                  for (let i = start; i <= end; i++) {
                    config.megabasAnalogOutputs.push({
                      channel: i,
                      name: bauFunction.includes('Speed') ? `VFD ${i} Speed` : bauFunction,
                      type: '0-10V',
                      range: bauFunction.includes('Speed') ? '0-10V' : '0-10V'
                    });
                  }
                }
              } else if (bauChannel.startsWith('AI')) {
                // Analog inputs
                const aiMatch = bauChannel.match(/AI(\d+)(?:-AI(\d+))?/);
                if (aiMatch) {
                  const start = parseInt(aiMatch[1]);
                  const end = aiMatch[2] ? parseInt(aiMatch[2]) : start;
                  for (let i = start; i <= end; i++) {
                    config.megabasInputs.push({
                      channel: i,
                      name: bauFunction.includes('Current') ? `VFD Current ${i}` : bauFunction,
                      type: bauFunction.includes('Current') ? '0-10V' : '0-10V',
                      conversion: bauFunction.includes('Current') ? 'current' : 'voltage',
                      range: bauFunction.includes('0-50A') ? '0-50A' : '0-10V'
                    });
                  }
                }
              }
            }
            
              } else if (col1Channel.match(/CH\d+|\d+/)) {
                // 16-Input channel
                const inputChannel = col1Channel;
                const inputFunction = col1Function;
                
                let chMatch = inputChannel.match(/CH(\d+)(?:-CH(\d+))?/);
                if (!chMatch) {
                  chMatch = inputChannel.match(/(\d+)(?:-(\d+))?/);
                }
                
                if (chMatch) {
                  const start = parseInt(chMatch[1]);
                  const end = chMatch[2] ? parseInt(chMatch[2]) : start;
                  for (let i = start; i <= end; i++) {
                    let sensorType = '0-10V';
                    let conversionType = 'voltage';
                    
                    if (inputFunction.includes('RTD') || inputFunction.includes('Temp') || inputFunction.includes('Temperature')) {
                      sensorType = '1k';
                      conversionType = 'temperature';
                    } else if (inputFunction.includes('Current') || inputFunction.includes('Amps')) {
                      sensorType = '0-10V';
                      conversionType = 'current';
                    }
                    
                    config.input16Channels.push({
                      channel: i,
                      name: inputFunction,
                      type: sensorType,
                      conversion: conversionType,
                      range: inputFunction.includes('0-50A') ? '0-50A' : sensorType
                    });
                    console.log(`Added 16-Input CH${i}: ${inputFunction} (${sensorType}/${conversionType})`);
                  }
                }
              }
            }
            
            // Process second pair
            if (col2Channel && col2Function && col2Channel !== '') {
              // Similar logic for second column pair
              if (col2Channel.match(/CH\d+|\d+/)) {
                // Could be 16-Input or 16-Relay
                let chMatch = col2Channel.match(/CH(\d+)(?:-CH(\d+))?/);
                if (!chMatch) {
                  chMatch = col2Channel.match(/(\d+)(?:-(\d+))?/);
                }
                
                if (chMatch) {
                  const start = parseInt(chMatch[1]);
                  const end = chMatch[2] ? parseInt(chMatch[2]) : start;
                  
                  // Determine if it's a relay based on function name
                  if (col2Function.includes('Relay') || col2Function.includes('Heater') || col2Function.includes('Pump')) {
                    for (let i = start; i <= end; i++) {
                      config.relay16Channels.push({
                        channel: i,
                        name: col2Function,
                        type: 'relay'
                      });
                      console.log(`Added 16-Relay CH${i}: ${col2Function}`);
                    }
                  } else {
                    // It's an input
                    for (let i = start; i <= end; i++) {
                      let sensorType = '0-10V';
                      let conversionType = 'voltage';
                      
                      if (col2Function.includes('RTD') || col2Function.includes('Temp')) {
                        sensorType = '1k';
                        conversionType = 'temperature';
                      }
                      
                      config.input16Channels.push({
                        channel: i,
                        name: col2Function,
                        type: sensorType,
                        conversion: conversionType,
                        range: sensorType
                      });
                      console.log(`Added 16-Input CH${i}: ${col2Function} (${sensorType}/${conversionType})`);
                    }
                  }
                }
              }
            }
          } else if (cells.length === 2) {
            // 2-column format: Channel, Function
            const channel = cells[0]?.textContent?.trim();
            const func = cells[1]?.textContent?.trim();
            
            if (channel && func && channel !== '') {
              // Determine board type from channel format
              if (channel.match(/T\d+/)) {
                // MegaBAS Triac
                const matches = channel.match(/T(\d+)(?:-T(\d+))?/);
                if (matches) {
                  const start = parseInt(matches[1]);
                  const end = matches[2] ? parseInt(matches[2]) : start;
                  for (let i = start; i <= end; i++) {
                    config.megabasTriacs.push({
                      channel: i,
                      name: func,
                      type: '24VAC Triac'
                    });
                  }
                }
              } else if (channel.match(/AO\d+/)) {
                // MegaBAS Analog Output
                const matches = channel.match(/AO(\d+)(?:-AO(\d+))?/);
                if (matches) {
                  const start = parseInt(matches[1]);
                  const end = matches[2] ? parseInt(matches[2]) : start;
                  for (let i = start; i <= end; i++) {
                    config.megabasAnalogOutputs.push({
                      channel: i,
                      name: func,
                      type: '0-10V',
                      range: '0-10V'
                    });
                  }
                }
              } else if (channel.match(/AI\d+/)) {
                // MegaBAS Analog Input
                const matches = channel.match(/AI(\d+)(?:-AI(\d+))?/);
                if (matches) {
                  const start = parseInt(matches[1]);
                  const end = matches[2] ? parseInt(matches[2]) : start;
                  for (let i = start; i <= end; i++) {
                    const isCurrentSensor = func.includes('Current') || func.includes('Amps') || func.includes('0-50A');
                    config.megabasInputs.push({
                      channel: i,
                      name: func,
                      type: '0-10V',
                      conversion: isCurrentSensor ? 'current' : 'voltage',
                      range: func.includes('0-50A') ? '0-50A' : 
                             func.includes('0-20A') ? '0-20A' : 
                             func.includes('0-100A') ? '0-100A' : '0-10V'
                    });
                    console.log(`Added MegaBAS AI${i}: ${func} (${isCurrentSensor ? 'current' : 'voltage'})`);
                  }
                }
              } else if (channel.match(/CH\d+|^\d+$/)) {
                // 16-Input or 16-Relay channel
                let chMatch = channel.match(/CH(\d+)(?:-CH(\d+))?/);
                if (!chMatch) {
                  chMatch = channel.match(/^(\d+)(?:-(\d+))?$/);
                }
                
                if (chMatch) {
                  const start = parseInt(chMatch[1]);
                  const end = chMatch[2] ? parseInt(chMatch[2]) : start;
                  
                  // Determine type from function name
                  if (func.includes('Relay') || func.includes('Heater') || func.includes('Pump') || func.includes('Valve')) {
                    // It's a relay
                    for (let i = start; i <= end; i++) {
                      config.relay16Channels.push({
                        channel: i,
                        name: func,
                        type: 'relay'
                      });
                      console.log(`Added 16-Relay CH${i}: ${func}`);
                    }
                  } else {
                    // It's an input
                    for (let i = start; i <= end; i++) {
                      let sensorType = '0-10V';
                      let conversionType = 'voltage';
                      
                      if (func.includes('RTD') || func.includes('Temp') || func.includes('Temperature')) {
                        sensorType = '1k';
                        conversionType = 'temperature';
                      } else if (func.includes('Current') || func.includes('Amps')) {
                        sensorType = '0-10V';
                        conversionType = 'current';
                      } else if (func.includes('Pressure')) {
                        sensorType = '0-10V';
                        conversionType = 'pressure';
                      }
                      
                      config.input16Channels.push({
                        channel: i,
                        name: func,
                        type: sensorType,
                        conversion: conversionType,
                        range: func.includes('0-50A') ? '0-50A' : 
                               func.includes('0-20A') ? '0-20A' : 
                               func.includes('0-100A') ? '0-100A' : sensorType
                      });
                      console.log(`Added 16-Input CH${i}: ${func} (${sensorType}/${conversionType})`);
                    }
                  }
                }
              }
            }
          }
        });
      });
      
      // Extract sensor specifications from notes
      const notesText = doc.querySelector('.notes')?.textContent || '';
      if (notesText.includes('0-10VDC') && notesText.includes('0-50A')) {
        config.sensorSpecs.currentSensors = '0-10VDC (0V=0A, 10V=50A)';
      }
      if (notesText.includes('1K Platinum RTD')) {
        config.sensorSpecs.tempSensors = '1K Platinum RTD';
      }
      
      // Extract system components
      const componentsList = doc.querySelectorAll('ul li');
      componentsList.forEach(item => {
        const text = item.textContent || '';
        if (text.includes('VFD') || text.includes('Pump') || text.includes('Sensor') || 
            text.includes('Valve') || text.includes('Heater')) {
          config.systemComponents.push(text.trim());
        }
      });
      
      // Extract Equipment IDs (UUIDs) from the document
      // Look for UUID patterns in the HTML
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
      const allText = doc.body?.textContent || '';
      const foundUUIDs = allText.match(uuidPattern) || [];
      
      // Also look for equipment ID references in specific elements
      const equipmentElements = doc.querySelectorAll('[data-equipment-id], [data-tower-id], .equipment-id, .tower-id');
      equipmentElements.forEach(elem => {
        const id = elem.getAttribute('data-equipment-id') || 
                  elem.getAttribute('data-tower-id') || 
                  elem.textContent?.match(uuidPattern)?.[0];
        if (id && !config.equipmentIds?.includes(id)) {
          config.equipmentIds?.push(id);
        }
      });
      
      // Add any UUIDs found in the document text
      foundUUIDs.forEach(uuid => {
        if (!config.equipmentIds?.includes(uuid)) {
          config.equipmentIds?.push(uuid);
        }
      });
      
      // Also look for tower-specific references in tables
      const tableCells = doc.querySelectorAll('td');
      tableCells.forEach(cell => {
        const text = cell.textContent || '';
        if (text.includes('Tower') && text.includes('UUID')) {
          const matches = text.match(uuidPattern);
          if (matches) {
            matches.forEach(uuid => {
              if (!config.equipmentIds?.includes(uuid)) {
                config.equipmentIds?.push(uuid);
              }
            });
          }
        }
      });
      
      console.log(`Extracted ${config.equipmentIds?.length || 0} equipment IDs from configuration`);
      
      // Auto-configure PID controllers based on analog outputs found
      configurePIDFromParsedConfig(config);
      
      return config;
    } catch (error) {
      console.error('Error parsing hardware config HTML:', error);
      return null;
    }
  };
  
  const configurePIDFromParsedConfig = (config: any) => {
    if (!config || !config.megabasAnalogOutputs) return;
    
    const newPIDControllers: any[] = [];
    
    // Analyze each analog output and create appropriate PID controller
    config.megabasAnalogOutputs.forEach((ao: any) => {
      const name = ao.name.toLowerCase();
      let pidConfig: any = {
        name: ao.name,
        enabled: false,  // Start disabled until user enables
        setpoint: 72,    // Default setpoint
        kp: 2.0,
        ki: 0.5,
        kd: 0.1,
        minV: 0.0,
        maxV: 10.0,
        reverseActing: false,
        output: 0,
        outputChannel: `AO${ao.channel}`,
        processVariable: ''  // Will be determined based on type
      };
      
      // Determine PID parameters based on equipment type
      if (name.includes('bypass')) {
        // Bypass valve for temperature control
        pidConfig.name = ao.name || `Bypass Valve (AO${ao.channel})`;
        pidConfig.setpoint = 70;  // Typical supply temp
        pidConfig.kp = 2.5;
        pidConfig.ki = 0.3;
        pidConfig.kd = 0.1;
        pidConfig.processVariable = 'CH1';  // Usually supply temp
        
      } else if (name.includes('vfd') || name.includes('speed') || name.includes('fan')) {
        // VFD/Fan speed control
        pidConfig.name = ao.name || `VFD Speed (AO${ao.channel})`;
        pidConfig.setpoint = 75;
        pidConfig.kp = 1.5;
        pidConfig.ki = 0.2;
        pidConfig.kd = 0.05;
        // Check if it's for cooling tower (limited speed range)
        if (name.includes('tower') || name.includes('cell')) {
          pidConfig.minV = 4.0;  // Low speed
          pidConfig.maxV = 5.5;  // High speed
        } else {
          pidConfig.minV = 2.0;  // 20% min for general VFD
          pidConfig.maxV = 10.0; // 100% max
        }
        pidConfig.processVariable = 'CH2';  // Usually return temp
        
      } else if (name.includes('damper') || name.includes('oa') || name.includes('outside')) {
        // Outside air damper
        pidConfig.name = ao.name || `OA Damper (AO${ao.channel})`;
        pidConfig.setpoint = 72;
        pidConfig.kp = 2.0;
        pidConfig.ki = 0.5;
        pidConfig.kd = 0.1;
        pidConfig.minV = 2.0;   // 20% minimum
        pidConfig.maxV = 10.0;
        pidConfig.processVariable = 'AI1';  // Mixed air temp typically
        
      } else if (name.includes('hw') || name.includes('hot') || name.includes('heat')) {
        // Hot water valve
        pidConfig.name = ao.name || `HW Valve (AO${ao.channel})`;
        pidConfig.setpoint = 72;
        pidConfig.kp = 3.0;
        pidConfig.ki = 0.8;
        pidConfig.kd = 0.2;
        pidConfig.reverseActing = true;  // Heating is reverse acting
        pidConfig.processVariable = 'AI2';  // Space or discharge temp
        
      } else if (name.includes('cw') || name.includes('chilled') || name.includes('cool')) {
        // Chilled water valve
        pidConfig.name = ao.name || `CW Valve (AO${ao.channel})`;
        pidConfig.setpoint = 72;
        pidConfig.kp = 2.5;
        pidConfig.ki = 0.6;
        pidConfig.kd = 0.15;
        pidConfig.reverseActing = false;  // Cooling is direct acting
        pidConfig.processVariable = 'AI2';  // Space or discharge temp
        
      } else if (name.includes('valve')) {
        // Generic valve
        pidConfig.name = ao.name || `Control Valve (AO${ao.channel})`;
        pidConfig.kp = 2.5;
        pidConfig.ki = 0.5;
        pidConfig.kd = 0.1;
        pidConfig.processVariable = 'AI1';
        
      } else {
        // Generic analog output
        pidConfig.name = ao.name || `Analog Output ${ao.channel}`;
        pidConfig.processVariable = 'AI1';
      }
      
      newPIDControllers.push(pidConfig);
    });
    
    // Update PID controllers state
    setPidControllers(newPIDControllers);
    console.log(`Auto-configured ${newPIDControllers.length} PID controllers from hardware config`);
  };
  
  const parseEquipmentIdsFromLogic = (content: string) => {
    // Look for equipment ID patterns in the logic file
    const equipmentData: Array<{id: string, name: string}> = [];
    
    // Try to find equipmentMap with names in comments
    const mapPattern = /(?:const|let|var)?\s*equipmentMap\s*=\s*{([^}]+)}/s;
    const mapMatch = content.match(mapPattern);
    
    if (mapMatch) {
      const mapContent = mapMatch[1];
      // Match pattern like "2JFzwQkC1XwJhUvm09rE": 1, // AHU-1
      const entryPattern = /["']([a-zA-Z0-9]{20})["']\s*:\s*\d+,?\s*\/\/\s*([^\n]+)/g;
      let match;
      while ((match = entryPattern.exec(mapContent)) !== null) {
        equipmentData.push({
          id: match[1],
          name: match[2].trim()
        });
      }
    }
    
    // If no comments found, try to extract from the configuration comments section
    if (equipmentData.length === 0) {
      // Look for patterns like: - AHU-1 (2JFzwQkC1XwJhUvm09rE):
      const configPattern = /-\s*([^(]+)\s*\(([a-zA-Z0-9]{20})\)/g;
      let match;
      while ((match = configPattern.exec(content)) !== null) {
        equipmentData.push({
          id: match[2],
          name: match[1].trim()
        });
      }
    }
    
    // If still no equipment found, look for standalone IDs
    if (equipmentData.length === 0) {
      const idPattern = /["']([a-zA-Z0-9]{20})["']/g;
      const foundIds = new Set<string>();
      let match;
      while ((match = idPattern.exec(content)) !== null) {
        if (!foundIds.has(match[1])) {
          foundIds.add(match[1]);
          equipmentData.push({
            id: match[1],
            name: `Equipment ${match[1].substring(0, 6)}`
          });
        }
      }
    }
    
    return equipmentData;
  };

  const fetchLogicResults = async () => {
    if (!selectedEquipment || !autoRunEnabled) return;
    
    try {
      const response = await authenticatedFetch(`/api/logic/results/${selectedEquipment}`);
      if (response.ok) {
        const data = await response.json();
        setLogicResults(data);
      }
    } catch (error) {
      console.error('Error fetching logic results:', error);
    }
  };

  const fetchExecutionResults = async () => {
    try {
      const response = await authenticatedFetch('/api/logic/execution-results');
      if (response.ok) {
        const data = await response.json();
        setExecutionResults(data);
      }
    } catch (error) {
      console.error('Error fetching execution results:', error);
    }
  };

  const fetchCurrentLogic = async () => {
    if (!selectedEquipment) return;
    try {
      // Get logic file content
      const response = await authenticatedFetch(`/api/logic/current/${selectedEquipment}`);
      if (response.ok) {
        const data = await response.text();
        setLogicContent(data);
        setOriginalLogicContent(data);
        setIsEditingLogic(false);
      } else if (response.status === 404) {
        setLogicContent('');
        setOriginalLogicContent('');
      }
      
      // Get configuration from database
      const configResponse = await authenticatedFetch(`/api/logic/config/${selectedEquipment}`);
      if (configResponse.ok) {
        const config = await configResponse.json();
        setLogicEnabled(config.enabled || false);
        setAutoRunEnabled(config.autoRunEnabled || false);
        setPollingInterval(config.pollingInterval || 7);
        setConfigChanged(false);
        
        // If auto-run is enabled, start fetching results
        if (config.autoRunEnabled) {
          fetchLogicResults();
        }
      }
    } catch (error) {
      console.error('Error fetching current logic:', error);
    }
  };

  const handleConfigHtmlUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.html')) {
      setConfigHtmlFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const parsed = parseHardwareConfigFromHTML(content);
        if (parsed) {
          setParsedHardwareConfig(parsed);
          setShowConfigPreview(true);
        } else {
          alert('Failed to parse configuration HTML file');
        }
      };
      reader.readAsText(file);
    } else {
      alert('Please select a valid .html configuration file');
    }
  };

  const applyParsedConfiguration = async () => {
    if (!parsedHardwareConfig) return;
    
    try {
      // Convert parsed config to board configurations
      const newBoardConfigs: BoardConfig[] = [];
      
      // MegaBAS configuration
      if (parsedHardwareConfig.megabasInputs.length > 0 || 
          parsedHardwareConfig.megabasTriacs.length > 0 || 
          parsedHardwareConfig.megabasAnalogOutputs.length > 0) {
        const megabasConfig: BoardConfig = {
          boardType: 'megabas',
          stackAddress: 0,
          enabled: true,
          outputs: {},
          inputs: {}
        };
        
        // Configure triacs
        parsedHardwareConfig.megabasTriacs.forEach((triac: any) => {
          megabasConfig.outputs[triac.channel] = {
            name: triac.name,
            type: 'triac',
            enabled: true
          };
        });
        
        // Configure analog outputs
        parsedHardwareConfig.megabasAnalogOutputs.forEach((ao: any) => {
          megabasConfig.outputs[ao.channel + 4] = { // AO1-4 are channels 5-8 in outputs
            name: ao.name,
            type: '0-10V',
            enabled: true
          };
        });
        
        // Configure inputs with proper scaling for current sensors
        parsedHardwareConfig.megabasInputs.forEach((input: any) => {
          const inputConfig: any = {
            name: input.name,
            inputType: '0-10V',
            conversionType: input.conversion === 'amps' ? 'amps' : 'voltage',
            enabled: true
          };
          
          // Add scaling for current sensors
          if (input.scaling) {
            inputConfig.scaling = input.scaling;
          }
          
          megabasConfig.inputs![input.channel] = inputConfig;
          console.log(`Configured MegaBAS input ${input.channel}: ${input.name} as ${inputConfig.conversionType}${input.scaling ? ' with scaling ' + input.scaling : ''}`);
        });
        
        newBoardConfigs.push(megabasConfig);
      }
      
      // 16-Input configuration
      if (parsedHardwareConfig.input16Channels.length > 0) {
        const input16Config: BoardConfig = {
          boardType: '16univin',
          stackAddress: 0,
          enabled: true,
          outputs: {},
          inputs: {}
        };
        
        parsedHardwareConfig.input16Channels.forEach((input: any) => {
          const inputConfig: any = {
            name: input.name,
            inputType: input.type === '1k' ? '1k' : '0-10V',
            conversionType: input.conversion === 'temperature' ? 'temperature' : 
                           input.conversion === 'amps' ? 'amps' : 'voltage',
            enabled: true
          };
          
          // Add scaling for current sensors
          if (input.scaling) {
            inputConfig.scaling = input.scaling;
          }
          
          input16Config.inputs![input.channel] = inputConfig;
          console.log(`Configured 16-Input CH${input.channel}: ${input.name} as ${input.type}/${inputConfig.conversionType}${input.scaling ? ' with scaling ' + input.scaling : ''}`);
        });
        
        newBoardConfigs.push(input16Config);
      }
      
      // 16-Relay configuration
      if (parsedHardwareConfig.relay16Channels.length > 0) {
        const relay16Config: BoardConfig = {
          boardType: '16relind',
          stackAddress: 0,
          enabled: true,
          outputs: {},
          inputs: {}
        };
        
        parsedHardwareConfig.relay16Channels.forEach((relay: any) => {
          relay16Config.outputs[relay.channel] = {
            name: relay.name,
            type: 'relay',
            enabled: true
          };
        });
        
        newBoardConfigs.push(relay16Config);
      }
      
      // Save the configuration
      setBoardConfigs(newBoardConfigs);
      
      // Save to backend
      const response = await authenticatedFetch('/api/logic/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newBoardConfigs)
      });
      
      if (response.ok) {
        alert('Hardware configuration applied successfully!');
        setShowConfigPreview(false);
        setConfigHtmlFile(null);
        setParsedHardwareConfig(null);
        setActiveTab('boards'); // Switch to boards tab to show the configuration
      } else {
        alert('Failed to save hardware configuration');
      }
    } catch (error) {
      console.error('Error applying configuration:', error);
      alert('Error applying hardware configuration');
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.js')) {
      setLogicFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setLogicContent(content);
        
        // Check if this is a cooling tower control file
        if (content.includes('processCoolingTowerControl')) {
          // Extract the actual equipment IDs from the EQUIPMENT_IDS constant
          const equipmentIds: string[] = [];
          const equipmentNames: string[] = [];

          // Look for EQUIPMENT_IDS constant
          const idsMatch = content.match(/const\s+EQUIPMENT_IDS\s*=\s*{([^}]+)}/s);
          if (idsMatch) {
            const idsContent = idsMatch[1];
            // Extract each tower ID
            const towerPattern = /COOLING_TOWER_(\d+):\s*['"]([a-zA-Z0-9]{20})['"]/g;
            let match;
            while ((match = towerPattern.exec(idsContent)) !== null) {
              const towerNum = match[1];
              const towerId = match[2];
              equipmentIds.push(towerId);
              equipmentNames.push(`Cooling Tower ${towerNum}`);
            }
          }

          if (equipmentIds.length > 0) {
            // Create equipment entries for each tower
            const towerEquipment = equipmentIds.map((id, index) => ({
              id: id,
              name: equipmentNames[index],
              hasLogic: false,
              fromFile: true
            }));
            setEquipmentList(towerEquipment);
            // Select all tower IDs (comma-separated)
            setSelectedEquipment(equipmentIds.join(','));
          } else {
            // Fallback if we can't extract IDs
            const coolingTowerEquipment = {
              id: 'COOLING-TOWER-SYSTEM',
              name: 'Cooling Tower Control System',
              hasLogic: false,
              fromFile: true
            };
            setEquipmentList([coolingTowerEquipment]);
            setSelectedEquipment('COOLING-TOWER-SYSTEM');
          }
        } else {
          // Parse equipment IDs and names from the logic file
          const parsedEquipment = parseEquipmentIdsFromLogic(content);
          if (parsedEquipment.length > 0) {
            // Update equipment list with ALL parsed IDs and their names
            const newEquipment = parsedEquipment.map(eq => ({
              id: eq.id,
              name: eq.name,
              hasLogic: false,
              fromFile: true
            }));
            setEquipmentList(prev => {
              // Keep existing equipment that have logic saved
              const existingWithLogic = prev.filter(e => e.hasLogic);
              // Add all new parsed equipment with names
              return [...existingWithLogic, ...newEquipment];
            });
            // Don't auto-select, let user choose
            setSelectedEquipment('');
          }
        }
      };
      reader.readAsText(file);
    } else {
      alert('Please select a valid .js file');
    }
  };

  const handleUploadLogic = async () => {
    if (!logicContent) {
      alert('Please select a logic file first');
      return;
    }
    if (!selectedEquipment) {
      alert('Please select an equipment ID first');
      return;
    }

    const confirmUpload = window.confirm(
      `Save configuration for Equipment ID: ${selectedEquipment}?\n\n` +
      `Logic Execution: ${logicEnabled ? 'ENABLED' : 'DISABLED'}\n` +
      `Auto-Run: ${autoRunEnabled ? 'ENABLED' : 'DISABLED'}${autoRunEnabled ? ` (every ${pollingInterval} seconds)` : ''}\n\n` +
      `This will ${logicEnabled ? 'enable' : 'disable'} local failover control when the BMS server is unavailable.`
    );
    if (!confirmUpload) return;

    try {
      const response = await authenticatedFetch('/api/logic/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: logicContent,
          equipmentId: selectedEquipment,
          enabled: logicEnabled,
          autoRunEnabled: autoRunEnabled,
          pollingInterval: pollingInterval
        })
      });

      if (response.ok) {
        alert(`Configuration saved successfully for ${selectedEquipment}`);
        setConfigChanged(false);
        fetchEquipmentList();
        fetchCurrentLogic();
        
        // Start or stop local controller service based on enabled status
        if (logicEnabled) {
          await authenticatedFetch('/api/logic/start-controller', {
            method: 'POST'
          });
        }
      } else {
        alert('Failed to save configuration');
      }
    } catch (error) {
      console.error('Error saving configuration:', error);
      alert('Error saving configuration');
    }
  };
  
  const handleResetConfiguration = async () => {
    const confirmReset = window.confirm(`Reset ALL configurations?\n\nThis will:\n- Clear all board configurations\n- Remove loaded hardware config\n- Clear equipment logic files`);
    if (!confirmReset) return;
    
    // Clear board configs
    setBoardConfigs([]);
    setParsedHardwareConfig(null);
    setConfigHtmlFile(null);
    setPidControllers([]);
    
    // Clear from backend
    try {
      await authenticatedFetch('/api/logic/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([])
      });
      
      // If equipment selected, clear that too
      if (selectedEquipment) {
        await authenticatedFetch(`/api/logic/delete/${selectedEquipment}`, {
          method: 'DELETE'
        });
        setLogicContent('');
        setLogicFile(null);
        setOriginalLogicContent('');
        setIsEditingLogic(false);
        setSelectedEquipment('');
      }
      
      alert('All configurations have been reset');
      fetchEquipmentList();
      
      // Reload board configs to clear everything
      window.location.reload();
    } catch (error) {
      console.error('Error resetting configuration:', error);
      alert('Error resetting configuration');
    }
  };
  
  const handleRemoveLogicFile = async () => {
    if (!selectedEquipment) {
      // Just clear the UI if no equipment selected
      setLogicFile(null);
      setLogicContent('');
      setOriginalLogicContent('');
      setSelectedEquipment('');
      setEquipmentList(prev => prev.filter(eq => eq.hasLogic));
      setIsEditingLogic(false);
      return;
    }

    const confirmDelete = window.confirm(
      `Remove logic file for ${selectedEquipment}?\n\nThis will delete the logic file from the server.`
    );
    if (!confirmDelete) return;

    try {
      // Delete from server
      const response = await authenticatedFetch(`/api/logic/delete/${selectedEquipment}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        // Clear UI state
        setLogicFile(null);
        setLogicContent('');
        setOriginalLogicContent('');
        setSelectedEquipment('');
        setIsEditingLogic(false);

        // Refresh equipment list
        await fetchEquipmentList();

        alert('Logic file removed successfully');
      } else {
        alert('Failed to remove logic file from server');
      }
    } catch (error) {
      console.error('Error removing logic file:', error);
      alert('Error removing logic file');
    }
  };

  const handleSaveLogicChanges = async () => {
    if (!selectedEquipment || !logicContent) {
      alert('No logic content to save');
      return;
    }

    const confirmSave = window.confirm(
      `Save logic changes for ${equipmentList.find(eq => eq.id === selectedEquipment)?.name || selectedEquipment}?\n\n` +
      `This will update the logic file that controls the equipment when in failover mode.`
    );
    if (!confirmSave) return;

    try {
      const response = await authenticatedFetch('/api/logic/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          content: logicContent,
          equipmentId: selectedEquipment,
          enabled: logicEnabled
        })
      });

      if (response.ok) {
        alert('Logic changes saved successfully');
        setOriginalLogicContent(logicContent);
        setIsEditingLogic(false);
        fetchEquipmentList();
      } else {
        alert('Failed to save logic changes');
      }
    } catch (error) {
      console.error('Error saving logic changes:', error);
      alert('Error saving logic changes');
    }
  };

  const handleCancelEdit = () => {
    setLogicContent(originalLogicContent);
    setIsEditingLogic(false);
  };

  const handleTestLogic = async () => {
    if (!selectedEquipment) {
      alert('Please select an equipment ID first');
      return;
    }

    // Check if we have logic content or if it's saved on server
    let testContent = logicContent;

    // If no logic content loaded in UI, try to fetch from server
    if (!testContent) {
      try {
        const checkResponse = await authenticatedFetch(`/api/logic/current/${selectedEquipment}`);
        if (checkResponse.ok) {
          testContent = await checkResponse.text();
        }
      } catch (error) {
        console.error('Error fetching saved logic:', error);
      }
    }

    if (!testContent) {
      alert('No logic file loaded or saved for this equipment');
      return;
    }

    setLogicRunning(true);
    setLogicOutput('Testing logic...\n');

    try {
      const response = await authenticatedFetch('/api/logic/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: testContent,
          equipmentId: selectedEquipment
        })
      });

      if (response.ok) {
        const result = await response.json();
        setLogicOutput(result.output || 'Test completed successfully');
      } else {
        const errorText = await response.text();
        setLogicOutput(`Test failed: ${errorText}`);
      }
    } catch (error) {
      console.error('Error testing logic:', error);
      setLogicOutput('Error: ' + error);
    } finally {
      setLogicRunning(false);
    }
  };

  const handleBoardConfigChange = async (boardIndex: number, field: string, value: any) => {
    const newConfigs = [...boardConfigs];
    if (field === 'type') {
      newConfigs[boardIndex].boardType = value;
      // Reset outputs when board type changes
      newConfigs[boardIndex].outputs = {};
      newConfigs[boardIndex].inputs = {};
    } else if (field === 'enabled') {
      newConfigs[boardIndex].enabled = value;
    } else if (field.startsWith('output_')) {
      const outputNum = parseInt(field.split('_')[1]);
      if (!newConfigs[boardIndex].outputs[outputNum]) {
        newConfigs[boardIndex].outputs[outputNum] = { name: '', type: '', enabled: false };
      }
      const outputField = field.split('_')[2];
      if (outputField === 'name' || outputField === 'type') {
        newConfigs[boardIndex].outputs[outputNum][outputField] = value as string;
      } else if (outputField === 'enabled') {
        newConfigs[boardIndex].outputs[outputNum].enabled = value as boolean;
      }
    } else if (field.startsWith('input_')) {
      const inputNum = parseInt(field.split('_')[1]);
      if (!newConfigs[boardIndex].inputs) {
        newConfigs[boardIndex].inputs = {};
      }
      if (!newConfigs[boardIndex].inputs![inputNum]) {
        newConfigs[boardIndex].inputs![inputNum] = { name: '', inputType: '0-10V', conversionType: 'temperature', enabled: false };
      }
      const inputField = field.split('_')[2];
      if (inputField === 'name') {
        newConfigs[boardIndex].inputs![inputNum].name = value as string;
      } else if (inputField === 'type') {
        newConfigs[boardIndex].inputs![inputNum].inputType = value;
      } else if (inputField === 'conversion') {
        newConfigs[boardIndex].inputs![inputNum].conversionType = value;
      } else if (inputField === 'scaling') {
        newConfigs[boardIndex].inputs![inputNum].scaling = value;
      } else if (inputField === 'enabled') {
        newConfigs[boardIndex].inputs![inputNum].enabled = value as boolean;
      }
    }
    
    setBoardConfigs(newConfigs);
    
    // Save to backend
    try {
      await authenticatedFetch('/api/logic/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfigs)
      });
    } catch (error) {
      console.error('Error saving board config:', error);
    }
  };

  const toggleBMSConnection = async () => {
    try {
      const response = await authenticatedFetch('/api/logic/bms-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !bmsEnabled })
      });

      if (response.ok) {
        setBmsEnabled(!bmsEnabled);
        fetchBMSStatus();
      }
    } catch (error) {
      console.error('Error toggling BMS:', error);
    }
  };
  
  const handleAutoRunToggle = async () => {
    const newState = !autoRunEnabled;
    setAutoRunEnabled(newState);
    setConfigChanged(true);
    
    try {
      const response = await authenticatedFetch('/api/logic/auto-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          enabled: newState,
          interval: pollingInterval 
        })
      });
      
      if (response.ok) {
        setConfigChanged(false);
      }
    } catch (error) {
      console.error('Error toggling auto-run:', error);
    }
  };
  
  const handlePollingIntervalChange = async (interval: number) => {
    setPollingInterval(interval);
    setConfigChanged(true);
    
    if (autoRunEnabled) {
      try {
        const response = await authenticatedFetch('/api/logic/auto-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            enabled: autoRunEnabled,
            interval: interval 
          })
        });
        
        if (response.ok) {
          setConfigChanged(false);
        }
      } catch (error) {
        console.error('Error updating polling interval:', error);
      }
    }
  };
  
  const updatePIDController = async (index: number, field: string, value: any) => {
    const newControllers = [...pidControllers];
    newControllers[index] = { ...newControllers[index], [field]: value };
    setPidControllers(newControllers);

    // Save to backend
    try {
      const controller = newControllers[index];
      await authenticatedFetch(`/api/pid-controllers/${controller.equipmentId}/${controller.controllerType}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
    } catch (error) {
      console.error('Error saving PID config:', error);
    }
  };

  const getActionIcon = (action: string) => {
    if (!action) return '📝';
    
    switch (action.toUpperCase()) {
      case 'LOGIN': return '🔐';
      case 'LOGOUT': return '🚪';
      case 'CREATE': return '➕';
      case 'UPDATE': return '✏️';
      case 'DELETE': return '🗑️';
      case 'VIEW': return '👁️';
      default: return '📝';
    }
  };

  const getStatusColor = (status: string) => {
    if (!status) return '#6b7280'; // Gray for unknown
    return status === 'success' ? '#10b981' : '#ef4444';
  };

  // Removed unused getBoardOutputs function

  if (!isAdmin) {
    return (
      <AuthGuard>
        <div className="admin-container">
          <div className="access-denied">
            <AlertTriangle size={48} color="#ef4444" />
            <h2>Access Denied</h2>
            <p>You must be an administrator to access this page.</p>
          </div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="admin-container">
        <div className="admin-header">
          <div className="admin-title">
            <Shield size={28} />
            <h1>System Administration</h1>
          </div>
          <div className="admin-subtitle">
            Advanced Configuration & Monitoring
          </div>
        </div>

        <div className="admin-tabs">
          <button
            className={`tab-button ${activeTab === 'logic' ? 'active' : ''}`}
            onClick={() => setActiveTab('logic')}
          >
            <FileCode size={18} />
            <span>Logic Engine</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'pid' ? 'active' : ''}`}
            onClick={() => setActiveTab('pid')}
          >
            <Cpu size={18} />
            <span>PID Controllers</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'boards' ? 'active' : ''}`}
            onClick={() => setActiveTab('boards')}
          >
            <Settings size={18} />
            <span>Board Config</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'status' ? 'active' : ''}`}
            onClick={() => setActiveTab('status')}
          >
            <Activity size={18} />
            <span>BMS Status</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'audit' ? 'active' : ''}`}
            onClick={() => setActiveTab('audit')}
          >
            <FileText size={18} />
            <span>Audit Logs</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <Lock size={18} />
            <span>Security</span>
          </button>
        </div>

        <div className="admin-content">
          {activeTab === 'logic' && (
            <div className="logic-section">
              <h2>Equipment Configuration & Logic Control</h2>
              
              {/* Hardware Configuration Upload Section */}
              <div className="section" style={{ background: '#f0f9ff', padding: '20px', borderRadius: '8px', marginBottom: '20px', border: '2px solid #0ea5e9' }}>
                <h3 style={{ marginTop: 0, color: '#0c4a6e' }}>Hardware Configuration Import</h3>
                <p style={{ color: '#64748b', marginBottom: '15px' }}>
                  Upload a hardware configuration HTML file to automatically configure I/O assignments, sensor types, and device names.
                </p>
                
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginBottom: '15px' }}>
                  <input
                    ref={configFileInputRef}
                    type="file"
                    accept=".html"
                    onChange={handleConfigHtmlUpload}
                    style={{ display: 'none' }}
                  />
                  <button 
                    className="btn-primary"
                    onClick={() => configFileInputRef.current?.click()}
                    style={{ background: parsedHardwareConfig ? '#10b981' : '#0ea5e9', color: 'white' }}
                  >
                    <Upload size={14} />
                    {parsedHardwareConfig ? 'Config Loaded - Change File' : 'Select Config HTML'}
                  </button>
                  {(configHtmlFile || parsedHardwareConfig) && (
                    <>
                      <span style={{ color: '#374151', fontWeight: 500 }}>
                        {configHtmlFile?.name || 'Configuration Applied'}
                      </span>
                      <button 
                        className="btn-remove"
                        onClick={() => {
                          setConfigHtmlFile(null);
                          setParsedHardwareConfig(null);
                        }}
                        title="Remove configuration"
                      >
                        <XCircle size={14} />
                        Remove
                      </button>
                    </>
                  )}
                </div>
                
                {/* Configuration Preview Modal */}
                {showConfigPreview && parsedHardwareConfig && (
                  <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                  }}>
                    <div style={{
                      background: 'white',
                      borderRadius: '12px',
                      padding: '30px',
                      maxWidth: '800px',
                      maxHeight: '80vh',
                      overflow: 'auto',
                      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
                    }}>
                      <h3 style={{ marginTop: 0, marginBottom: '20px' }}>Hardware Configuration Preview</h3>
                      
                      {parsedHardwareConfig.projectInfo && (
                        <div style={{ marginBottom: '20px', padding: '10px', background: '#f9fafb', borderRadius: '6px' }}>
                          <h4 style={{ margin: '0 0 10px 0', color: '#374151' }}>Project Information</h4>
                          <p style={{ margin: '5px 0' }}>Project: {parsedHardwareConfig.projectInfo.project}</p>
                          <p style={{ margin: '5px 0' }}>Date: {parsedHardwareConfig.projectInfo.date}</p>
                          <p style={{ margin: '5px 0' }}>Contractor: {parsedHardwareConfig.projectInfo.contractor}</p>
                        </div>
                      )}
                      
                      {parsedHardwareConfig.megabasTriacs.length > 0 && (
                        <div style={{ marginBottom: '15px' }}>
                          <h4 style={{ color: '#374151' }}>MegaBAS Triacs</h4>
                          <ul style={{ margin: '5px 0' }}>
                            {parsedHardwareConfig.megabasTriacs.map((t: any, i: number) => (
                              <li key={i}>T{t.channel}: {t.name}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {parsedHardwareConfig.megabasAnalogOutputs.length > 0 && (
                        <div style={{ marginBottom: '15px' }}>
                          <h4 style={{ color: '#374151' }}>MegaBAS Analog Outputs</h4>
                          <ul style={{ margin: '5px 0' }}>
                            {parsedHardwareConfig.megabasAnalogOutputs.map((ao: any, i: number) => (
                              <li key={i}>AO{ao.channel}: {ao.name} ({ao.type})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {parsedHardwareConfig.megabasInputs.length > 0 && (
                        <div style={{ marginBottom: '15px' }}>
                          <h4 style={{ color: '#374151' }}>MegaBAS Inputs</h4>
                          <ul style={{ margin: '5px 0' }}>
                            {parsedHardwareConfig.megabasInputs.map((input: any, i: number) => (
                              <li key={i}>AI{input.channel}: {input.name} ({input.range})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {parsedHardwareConfig.input16Channels.length > 0 && (
                        <div style={{ marginBottom: '15px' }}>
                          <h4 style={{ color: '#374151' }}>16-Input Channels</h4>
                          <ul style={{ margin: '5px 0' }}>
                            {parsedHardwareConfig.input16Channels.map((ch: any, i: number) => (
                              <li key={i}>CH{ch.channel}: {ch.name} ({ch.type})</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {parsedHardwareConfig.relay16Channels.length > 0 && (
                        <div style={{ marginBottom: '15px' }}>
                          <h4 style={{ color: '#374151' }}>16-Relay Outputs</h4>
                          <ul style={{ margin: '5px 0' }}>
                            {parsedHardwareConfig.relay16Channels.map((r: any, i: number) => (
                              <li key={i}>Relay {r.channel}: {r.name}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
                        <button 
                          className="btn-cancel"
                          onClick={() => {
                            setShowConfigPreview(false);
                            setParsedHardwareConfig(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button 
                          className="btn-success"
                          onClick={applyParsedConfiguration}
                        >
                          Apply Configuration
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              
              <h3>Equipment Logic Files (Failover Control)</h3>
              
              <div className="equipment-selector">
                <label>Equipment ID Configuration:</label>
                <div style={{ 
                  display: 'flex', 
                  gap: '10px', 
                  alignItems: 'flex-start',
                  marginBottom: '10px'
                }}>
                  <div style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={selectedEquipment}
                      onChange={(e) => {
                        setSelectedEquipment(e.target.value);
                        setConfigChanged(true);
                      }}
                      placeholder="Enter equipment UUID(s) - comma separated for multiple towers"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        fontFamily: 'monospace',
                        background: logicContent ? 'white' : '#f9fafb'
                      }}
                      disabled={!logicContent}
                    />
                    <small style={{ 
                      color: '#6b7280', 
                      display: 'block', 
                      marginTop: '5px' 
                    }}>
                      {parsedHardwareConfig && parsedHardwareConfig.equipmentIds ? 
                        `Extracted IDs from config: ${parsedHardwareConfig.equipmentIds.join(', ')}` :
                        'Equipment UUIDs will be extracted from config HTML file or enter manually'
                      }
                    </small>
                  </div>
                  <button
                    className="btn-secondary"
                    onClick={() => {
                      const ids = selectedEquipment.split(',').map(id => id.trim()).filter(id => id);
                      if (ids.length > 0) {
                        alert(`Equipment IDs configured:\n${ids.map((id, i) => `Tower ${i+1}: ${id}`).join('\n')}`);
                      } else {
                        alert('Please enter at least one equipment ID');
                      }
                    }}
                    style={{ 
                      background: '#6b7280',
                      color: 'white',
                      padding: '10px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 500
                    }}
                    disabled={!logicContent}
                  >
                    Validate IDs
                  </button>
                </div>
                
                {parsedHardwareConfig && parsedHardwareConfig.equipmentIds && (
                  <div style={{ 
                    marginTop: '10px',
                    padding: '12px',
                    background: '#f0f9ff',
                    borderRadius: '6px',
                    border: '1px solid #0ea5e9'
                  }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#0c4a6e' }}>
                      Equipment IDs from Configuration:
                    </h4>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {parsedHardwareConfig.equipmentIds?.map((id: string, index: number) => (
                        <button
                          key={id}
                          onClick={() => {
                            setSelectedEquipment(parsedHardwareConfig.equipmentIds?.join(', ') || '');
                            alert(`Loaded ${parsedHardwareConfig.equipmentIds?.length || 0} equipment IDs from configuration`);
                          }}
                          style={{
                            padding: '6px 12px',
                            background: '#0ea5e9',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontFamily: 'monospace'
                          }}
                        >
                          Tower {index + 1}: {id.substring(0, 8)}...
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        setSelectedEquipment(parsedHardwareConfig.equipmentIds?.join(', ') || '');
                      }}
                      style={{
                        marginTop: '10px',
                        padding: '8px 16px',
                        background: '#0ea5e9',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '14px',
                        cursor: 'pointer',
                        fontWeight: 500
                      }}
                    >
                      Use All IDs from Config
                    </button>
                  </div>
                )}
                
                {!logicContent && (
                  <div className="equipment-info">
                    <small>Upload a logic file first to configure equipment IDs</small>
                  </div>
                )}
              </div>
              
              {equipmentList.length > 0 && (
                <div className="existing-equipment">
                  <h4>Equipment with Local Logic Files:</h4>
                  <div className="equipment-grid">
                    {equipmentList.filter(eq => eq.hasLogic).map(eq => (
                      <button
                        key={eq.id}
                        className={`equipment-card ${selectedEquipment === eq.id ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedEquipment(eq.id);
                          fetchCurrentLogic();
                        }}
                      >
                        <span className="equipment-id">{eq.name} ({eq.id.substring(0, 8)}...)</span>
                        <span className="equipment-status">✓ Logic Uploaded</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="logic-controls">
                <div className="logic-enable-toggle">
                  <label className="toggle-container">
                    <span className="toggle-label-text">Logic Execution:</span>
                    <label className="toggle-switch large">
                      <input
                        type="checkbox"
                        checked={logicEnabled}
                        onChange={(e) => {
                          setLogicEnabled(e.target.checked);
                          setConfigChanged(true);
                        }}
                        disabled={!selectedEquipment}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className={`status-text ${logicEnabled ? 'enabled' : 'disabled'}`}>
                      {logicEnabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </label>
                </div>
                
                <div className="auto-run-controls">
                  <label className="toggle-container">
                    <span className="toggle-label-text">Auto-Run Logic:</span>
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={autoRunEnabled}
                        onChange={handleAutoRunToggle}
                        disabled={!logicEnabled}
                      />
                      <span className="toggle-slider"></span>
                    </label>
                    <span className={`status-text ${autoRunEnabled ? 'enabled' : 'disabled'}`}>
                      {autoRunEnabled ? 'RUNNING' : 'STOPPED'}
                    </span>
                  </label>
                  
                  {autoRunEnabled && (
                    <div className="polling-interval-selector">
                      <label>Run Interval:</label>
                      <select 
                        value={pollingInterval} 
                        onChange={(e) => handlePollingIntervalChange(Number(e.target.value))}
                        className="interval-select"
                      >
                        <option value={7}>7 seconds</option>
                        <option value={12}>12 seconds</option>
                        <option value={15}>15 seconds</option>
                        <option value={20}>20 seconds</option>
                        <option value={30}>30 seconds</option>
                        <option value={45}>45 seconds</option>
                        <option value={60}>1 minute</option>
                        <option value={300}>5 minutes</option>
                        <option value={900}>15 minutes</option>
                      </select>
                    </div>
                  )}
                </div>
                
                {configChanged && (
                  <div className="config-warning">
                    ⚠️ Configuration changed - Save to apply changes
                  </div>
                )}
              </div>
              
              <div className="logic-upload">
                <div className="upload-controls">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".js"
                    onChange={handleFileUpload}
                    style={{ display: 'none' }}
                  />
                  <button 
                    className="btn-primary"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ background: logicContent ? '#10b981' : '#3b82f6' }}
                  >
                    <Upload size={14} />
                    {logicContent ? 'Logic Loaded - Change File' : 'Select Logic File'}
                  </button>
                  {(logicFile || (logicContent && selectedEquipment)) && (
                    <>
                      <span className="file-name">
                        {logicFile?.name || `Logic for ${selectedEquipment?.substring(0, 20)}...`}
                      </span>
                      <button 
                        className="btn-remove"
                        onClick={handleRemoveLogicFile}
                        title="Remove selected file"
                      >
                        <XCircle size={14} />
                        Remove
                      </button>
                    </>
                  )}
                </div>
                
                <div className="logic-actions">
                  <button 
                    className="btn-primary"
                    onClick={handleUploadLogic}
                    disabled={!logicContent || !selectedEquipment}
                    style={{ background: '#14b8a6', borderColor: '#14b8a6' }}
                  >
                    <Upload size={14} />
                    Save Configuration
                  </button>
                  <button 
                    className="btn-info"
                    onClick={handleTestLogic}
                    disabled={!logicContent || logicRunning}
                  >
                    {logicRunning ? <Square size={14} /> : <Play size={14} />}
                    {logicRunning ? 'Testing...' : 'Test Logic'}
                  </button>
                  <button 
                    className="btn-danger"
                    onClick={handleResetConfiguration}
                    disabled={false}
                  >
                    <XCircle size={14} />
                    Reset Configuration
                  </button>
                </div>
              </div>

              <div className="logic-editor">
                <div className="editor-header">
                  <h3>Logic File Content</h3>
                  {logicContent && selectedEquipment && (
                    <div className="editor-actions">
                      {!isEditingLogic ? (
                        <button 
                          className="btn-modify"
                          onClick={() => setIsEditingLogic(true)}
                        >
                          <FileCode size={14} />
                          Modify Logic
                        </button>
                      ) : (
                        <>
                          <button 
                            className="btn-save-changes"
                            onClick={handleSaveLogicChanges}
                          >
                            <CheckCircle size={14} />
                            Save Logic Changes
                          </button>
                          <button 
                            className="btn-cancel"
                            onClick={handleCancelEdit}
                          >
                            <XCircle size={14} />
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <textarea
                  value={logicContent}
                  onChange={(e) => isEditingLogic && setLogicContent(e.target.value)}
                  placeholder="// Equipment logic code will appear here..."
                  spellCheck={false}
                  readOnly={!isEditingLogic}
                  className={isEditingLogic ? 'editing' : 'readonly'}
                />
                {isEditingLogic && (
                  <div className="edit-indicator">
                    <span>📝 Editing Mode - Make your changes and click "Save Logic Changes" when done</span>
                  </div>
                )}
              </div>

              {logicOutput && (
                <div className="logic-output">
                  <h3>Test Output</h3>
                  <pre>{logicOutput}</pre>
                </div>
              )}

              {/* Logic Execution Control Section */}
              {logicContent && selectedEquipment && logicContent.includes('processCoolingTowerControl') && (
                <div className="logic-execution-section" style={{
                  background: '#f0fdf4',
                  border: '2px solid #10b981',
                  borderRadius: '8px',
                  padding: '20px',
                  marginTop: '20px'
                }}>
                  <h3 style={{ color: '#065f46', marginTop: 0 }}>
                    <Cpu size={20} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
                    Logic Execution Engine
                  </h3>
                  
                  <div style={{ marginBottom: '15px' }}>
                    <p style={{ color: '#374151' }}>
                      The Cooling Tower Control Logic is ready for execution. When enabled, the system will:
                    </p>
                    <ul style={{ color: '#6b7280', marginLeft: '20px' }}>
                      <li>Read inputs from MegaBAS and 16-Input boards every {
                        pollingInterval >= 60 
                          ? pollingInterval === 60 
                            ? '1 minute' 
                            : `${pollingInterval / 60} minutes`
                          : `${pollingInterval} seconds`
                      }</li>
                      <li>Execute the control logic with real sensor data</li>
                      <li>Write outputs to control tower VFDs, valves, and heaters</li>
                      <li>Monitor safety limits and vibration levels</li>
                    </ul>
                  </div>
                  
                  <div style={{ 
                    display: 'flex', 
                    gap: '15px', 
                    alignItems: 'center',
                    padding: '15px',
                    background: 'white',
                    borderRadius: '6px'
                  }}>
                    <button
                      className="btn-success"
                      onClick={async () => {
                        if (confirm('Start real-time logic execution? This will control actual equipment based on sensor readings.')) {
                          try {
                            // First save the board configuration
                            await authenticatedFetch('/api/boards/save-config', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(boardConfigs)
                            });
                            
                            // Then start execution
                            const response = await authenticatedFetch('/api/logic/execute', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                logicFile: logicContent,
                                equipmentId: selectedEquipment,
                                pollingInterval: pollingInterval
                              })
                            });
                            
                            if (response.ok) {
                              alert('Logic execution started successfully!');
                              setAutoRunEnabled(true);
                            }
                          } catch (error) {
                            console.error('Failed to start execution:', error);
                            alert('Failed to start logic execution');
                          }
                        }
                      }}
                      disabled={!logicEnabled}
                    >
                      <Play size={14} />
                      Start Real-Time Execution
                    </button>
                    
                    <button
                      className="btn-danger"
                      onClick={async () => {
                        try {
                          const response = await authenticatedFetch('/api/logic/stop', {
                            method: 'POST'
                          });
                          
                          if (response.ok) {
                            alert('Logic execution stopped');
                            setAutoRunEnabled(false);
                          }
                        } catch (error) {
                          console.error('Failed to stop execution:', error);
                        }
                      }}
                    >
                      <Square size={14} />
                      Stop Execution
                    </button>
                    
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <label>Execution Interval:</label>
                      <select 
                        value={pollingInterval} 
                        onChange={(e) => setPollingInterval(Number(e.target.value))}
                        className="interval-select"
                      >
                        <option value={7}>7 seconds</option>
                        <option value={12}>12 seconds</option>
                        <option value={15}>15 seconds</option>
                        <option value={20}>20 seconds</option>
                        <option value={30}>30 seconds</option>
                        <option value={45}>45 seconds</option>
                        <option value={60}>1 minute</option>
                        <option value={300}>5 minutes</option>
                        <option value={900}>15 minutes</option>
                      </select>
                    </div>
                  </div>
                  
                  {autoRunEnabled && (
                    <div style={{ 
                      marginTop: '15px',
                      padding: '10px',
                      background: '#d1fae5',
                      borderRadius: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}>
                      <Activity size={18} color="#10b981" />
                      <span style={{ color: '#065f46', fontWeight: 500 }}>
                        Logic execution is ACTIVE - Reading sensors and controlling equipment
                      </span>
                    </div>
                  )}
                  
                  {/* Live Execution Results Window */}
                  {executionResults.length > 0 && (
                    <div style={{
                      marginTop: '20px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      padding: '15px',
                      background: '#f9fafb',
                      maxHeight: '400px',
                      overflow: 'auto'
                    }}>
                      <h4 style={{ margin: '0 0 15px 0', color: '#374151' }}>
                        Live Execution Results
                        <span style={{ 
                          float: 'right', 
                          fontSize: '12px', 
                          color: '#6b7280',
                          fontWeight: 'normal' 
                        }}>
                          Last {executionResults.length} executions
                        </span>
                      </h4>
                      
                      <div style={{ display: 'grid', gap: '10px' }}>
                        {executionResults.slice(-5).reverse().map((result, index) => (
                          <div key={index} style={{
                            background: 'white',
                            border: '1px solid #e5e7eb',
                            borderRadius: '4px',
                            padding: '10px',
                            fontSize: '12px'
                          }}>
                            <div style={{ 
                              display: 'flex', 
                              justifyContent: 'space-between',
                              marginBottom: '8px',
                              borderBottom: '1px solid #f3f4f6',
                              paddingBottom: '5px'
                            }}>
                              <span style={{ color: '#6b7280' }}>
                                {new Date(result.timestamp).toLocaleTimeString()}
                              </span>
                              <span style={{ color: '#10b981', fontWeight: 500 }}>
                                {result.activeLogic || 'CoolingTower'}
                              </span>
                            </div>
                            
                            {result.outputs && (
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                                <div>
                                  <span style={{ color: '#9ca3af' }}>Tower 1:</span>
                                  <span style={{ 
                                    marginLeft: '5px',
                                    color: result.outputs.tower1VFDEnable ? '#10b981' : '#6b7280',
                                    fontWeight: 500
                                  }}>
                                    {result.outputs.tower1VFDEnable ? 'ON' : 'OFF'}
                                    {result.outputs.tower1FanSpeed > 0 && ` (${result.outputs.tower1FanSpeed}V)`}
                                  </span>
                                </div>
                                
                                <div>
                                  <span style={{ color: '#9ca3af' }}>Tower 2:</span>
                                  <span style={{ 
                                    marginLeft: '5px',
                                    color: result.outputs.tower2VFDEnable ? '#10b981' : '#6b7280',
                                    fontWeight: 500
                                  }}>
                                    {result.outputs.tower2VFDEnable ? 'ON' : 'OFF'}
                                    {result.outputs.tower2FanSpeed > 0 && ` (${result.outputs.tower2FanSpeed}V)`}
                                  </span>
                                </div>
                                
                                <div>
                                  <span style={{ color: '#9ca3af' }}>Tower 3:</span>
                                  <span style={{ 
                                    marginLeft: '5px',
                                    color: result.outputs.tower3VFDEnable ? '#10b981' : '#6b7280',
                                    fontWeight: 500
                                  }}>
                                    {result.outputs.tower3VFDEnable ? 'ON' : 'OFF'}
                                    {result.outputs.tower3FanSpeed > 0 && ` (${result.outputs.tower3FanSpeed}V)`}
                                  </span>
                                </div>
                                
                                <div>
                                  <span style={{ color: '#9ca3af' }}>Active Towers:</span>
                                  <span style={{ marginLeft: '5px', fontWeight: 500 }}>
                                    {result.outputs.activeTowers || 0}
                                  </span>
                                </div>
                                
                                <div>
                                  <span style={{ color: '#9ca3af' }}>Cooling Demand:</span>
                                  <span style={{ marginLeft: '5px', fontWeight: 500 }}>
                                    {result.outputs.coolingDemand || 0}%
                                  </span>
                                </div>
                                
                                <div>
                                  <span style={{ color: '#9ca3af' }}>Delta-T:</span>
                                  <span style={{ marginLeft: '5px', fontWeight: 500 }}>
                                    {result.outputs.loopDeltaT?.toFixed(1) || '0.0'}°F
                                  </span>
                                </div>
                              </div>
                            )}
                            
                            {result.inputs && (
                              <div style={{ 
                                marginTop: '8px',
                                paddingTop: '8px',
                                borderTop: '1px solid #f3f4f6',
                                color: '#9ca3af',
                                fontSize: '11px'
                              }}>
                                Supply: {result.inputs.CH1?.toFixed(1) || '--'}°F | 
                                Return: {result.inputs.CH2?.toFixed(1) || '--'}°F | 
                                OAT: {result.inputs.outdoorTemp?.toFixed(1) || result.outputs?.outdoorTemp?.toFixed(1) || '--'}°F
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {autoRunEnabled && (
                <div className="processing-results">
                  <h3>Processing Logic Results {logicResults.length > 0 && <span className="live-indicator">● Live</span>}</h3>
                  {logicResults.length === 0 ? (
                    <div className="no-results">
                      <p>Waiting for logic execution results...</p>
                      <small>Results will appear here when the logic runs (every {
                        pollingInterval >= 60 
                          ? pollingInterval === 60 
                            ? '1 minute' 
                            : `${pollingInterval / 60} minutes`
                          : `${pollingInterval} seconds`
                      })</small>
                    </div>
                  ) : (
                    <>
                      <div className="results-grid">
                        {logicResults.map((result, index) => (
                          <div key={index} className="result-card">
                            <div className="result-timestamp">
                              {new Date(result.timestamp).toLocaleTimeString()}
                            </div>
                            <div className="result-data">
                              <div className="result-row">
                                <span className="result-label">Setpoint:</span>
                                <span className="result-value">{result.setpoint?.toFixed(1)}°F</span>
                              </div>
                              <div className="result-row">
                                <span className="result-label">Current:</span>
                                <span className="result-value">{result.currentTemp?.toFixed(1)}°F</span>
                              </div>
                              <div className="result-row">
                                <span className="result-label">Space/Supply/Outdoor:</span>
                                <span className="result-value">
                                  {result.spaceTemp?.toFixed(0) || '--'}/
                                  {result.supplyTemp?.toFixed(0) || '--'}/
                                  {result.outdoorTemp?.toFixed(0) || '--'}°F
                                </span>
                              </div>
                              <div className="result-row">
                                <span className="result-label">Heating:</span>
                                <span className="result-value heat">{result.heating?.toFixed(0)}%</span>
                              </div>
                              <div className="result-row">
                                <span className="result-label">Cooling:</span>
                                <span className="result-value cool">{result.cooling?.toFixed(0)}%</span>
                              </div>
                              <div className="result-row">
                                <span className="result-label">OA Damper:</span>
                                <span className="result-value">{result.damper?.toFixed(0)}%</span>
                              </div>
                              <div className="result-row">
                                <span className="result-label">Fan:</span>
                                <span className={`result-value ${result.fan ? 'active' : 'inactive'}`}>
                                  {result.fan ? 'ON' : 'OFF'} {result.fanSpeed && `(${result.fanSpeed})`}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="results-info">
                        <small>Showing last {logicResults.length} executions • Updates every 2 seconds</small>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'boards' && (
            <div className="boards-section">
              <h2>Sequent Microsystems Board Configuration</h2>
              
              <div className="boards-grid">
                {boardConfigs.map((config, index) => (
                  <div key={index} className="board-card">
                    <h3>
                      {config.boardType === 'megabas' && 'MegaBAS'}
                      {config.boardType === '16univin' && '16-Universal Inputs'}
                      {config.boardType === '16relind' && '16-Relay'}
                      {config.boardType === '16uout' && '16-Outputs'}
                      {config.boardType === '8relind' && '8-Relay'}
                      {' '}(Stack {config.stackAddress})
                    </h3>
                    
                    <div className="board-status">
                      <label className="board-toggle-container">
                        <span>Board Enabled</span>
                        <Switch
                          checked={config.enabled}
                          onCheckedChange={(checked) => handleBoardConfigChange(index, 'enabled', checked)}
                        />
                      </label>
                    </div>

                    {config.enabled && (
                      <div className="board-outputs">
                        <h4>Output Configuration</h4>
                        {config.boardType === 'megabas' && (
                          <>
                            <div className="output-group">
                              <h5>Triac Outputs (1-4)</h5>
                              {[1, 2, 3, 4].map(num => (
                                <div key={`triac-${num}`} className="output-item">
                                  <span className="output-number">T{num}</span>
                                  <input
                                    type="text"
                                    placeholder={`Triac ${num} name`}
                                    value={config.outputs[num]?.name || ''}
                                    onChange={(e) => handleBoardConfigChange(index, `output_${num}_name`, e.target.value)}
                                  />
                                  <Switch
                                    checked={config.outputs[num]?.enabled || false}
                                    onCheckedChange={(checked) => handleBoardConfigChange(index, `output_${num}_enabled`, checked)}
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="output-group">
                              <h5>0-10V Outputs (1-4)</h5>
                              {[5, 6, 7, 8].map((num, i) => (
                                <div key={`out-${num}`} className="output-item">
                                  <span className="output-number">AO{i + 1}</span>
                                  <input
                                    type="text"
                                    placeholder={`Output ${i + 1} name`}
                                    value={config.outputs[num]?.name || ''}
                                    onChange={(e) => handleBoardConfigChange(index, `output_${num}_name`, e.target.value)}
                                  />
                                  <Switch
                                    checked={config.outputs[num]?.enabled || false}
                                    onCheckedChange={(checked) => handleBoardConfigChange(index, `output_${num}_enabled`, checked)}
                                  />
                                </div>
                              ))}
                            </div>
                            <div className="input-group">
                              <h5>Universal Inputs (1-8)</h5>
                              {[1, 2, 3, 4, 5, 6, 7, 8].map(num => (
                                <div key={`input-${num}`} className="input-config-item">
                                  <span className="input-number">In{num}</span>
                                  <input
                                    type="text"
                                    placeholder={`Input ${num} name`}
                                    value={config.inputs?.[num]?.name || ''}
                                    onChange={(e) => handleBoardConfigChange(index, `input_${num}_name`, e.target.value)}
                                  />
                                  <select
                                    value={config.inputs?.[num]?.inputType || '0-10V'}
                                    onChange={(e) => handleBoardConfigChange(index, `input_${num}_type`, e.target.value)}
                                    className="input-type-select"
                                  >
                                    <option value="0-10V">0-10V</option>
                                    <option value="1k">1k RTD</option>
                                    <option value="10k">10k Thermistor</option>
                                  </select>
                                  <select
                                    value={config.inputs?.[num]?.conversionType || 'voltage'}
                                    onChange={(e) => handleBoardConfigChange(index, `input_${num}_conversion`, e.target.value)}
                                    className="conversion-select"
                                  >
                                    <option value="temperature">Temperature (°F)</option>
                                    <option value="amps">Current (Amps)</option>
                                    <option value="humidity">Humidity (%)</option>
                                    <option value="pressure">Pressure (PSI)</option>
                                    <option value="voltage">Voltage (V)</option>
                                  </select>
                                  {config.inputs?.[num]?.conversionType === 'amps' && (
                                    <select
                                      value={config.inputs?.[num]?.scaling || '0-50'}
                                      onChange={(e) => handleBoardConfigChange(index, `input_${num}_scaling`, e.target.value)}
                                      className="scaling-select"
                                    >
                                      <option value="0-20">0-20A</option>
                                      <option value="0-50">0-50A</option>
                                      <option value="0-100">0-100A</option>
                                    </select>
                                  )}
                                  <Switch
                                    checked={config.inputs?.[num]?.enabled !== false}
                                    onCheckedChange={(checked) => handleBoardConfigChange(index, `input_${num}_enabled`, checked)}
                                  />
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                        
                        {config.boardType === '16univin' && (
                          <div className="input-group">
                            <h5>16 Universal Inputs</h5>
                            {Array.from({ length: 16 }, (_, i) => i + 1).map(num => (
                              <div key={`input-${num}`} className="input-config-item">
                                <span className="input-number">In{num}</span>
                                <input
                                  type="text"
                                  placeholder={`Input ${num} name`}
                                  value={config.inputs?.[num]?.name || ''}
                                  onChange={(e) => handleBoardConfigChange(index, `input_${num}_name`, e.target.value)}
                                />
                                <select
                                  value={config.inputs?.[num]?.inputType || '0-10V'}
                                  onChange={(e) => handleBoardConfigChange(index, `input_${num}_type`, e.target.value)}
                                  className="input-type-select"
                                >
                                  <option value="0-10V">0-10V</option>
                                  <option value="1k">1k RTD</option>
                                  <option value="10k">10k Thermistor</option>
                                </select>
                                <select
                                  value={config.inputs?.[num]?.conversionType || 'temperature'}
                                  onChange={(e) => handleBoardConfigChange(index, `input_${num}_conversion`, e.target.value)}
                                  className="conversion-select"
                                >
                                  <option value="temperature">Temperature (°F)</option>
                                  <option value="amps">Current (Amps)</option>
                                  <option value="humidity">Humidity (%)</option>
                                  <option value="pressure">Pressure (PSI)</option>
                                  <option value="voltage">Voltage (V)</option>
                                </select>
                                {config.inputs?.[num]?.conversionType === 'amps' && (
                                  <select
                                    value={config.inputs?.[num]?.scaling || '0-50'}
                                    onChange={(e) => handleBoardConfigChange(index, `input_${num}_scaling`, e.target.value)}
                                    className="scaling-select"
                                  >
                                    <option value="0-20">0-20A</option>
                                    <option value="0-50">0-50A</option>
                                    <option value="0-100">0-100A</option>
                                  </select>
                                )}
                                <Switch
                                  checked={config.inputs?.[num]?.enabled !== false}
                                  onCheckedChange={(checked) => handleBoardConfigChange(index, `input_${num}_enabled`, checked)}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        
                        {(config.boardType === '16relind' || config.boardType === '8relind') && (
                          <div className="output-group">
                            <h5>Relays</h5>
                            {Array.from({ length: config.boardType === '16relind' ? 16 : 8 }, (_, i) => i + 1).map(num => (
                              <div key={`relay-${num}`} className="output-item compact">
                                <span>R{num}</span>
                                <input
                                  type="text"
                                  placeholder={`Relay ${num} name`}
                                  value={config.outputs[num]?.name || ''}
                                  onChange={(e) => handleBoardConfigChange(index, `output_${num}_name`, e.target.value)}
                                />
                                <Switch
                                  checked={config.outputs[num]?.enabled || false}
                                  onCheckedChange={(checked) => handleBoardConfigChange(index, `output_${num}_enabled`, checked)}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {config.boardType === '16uout' && (
                          <div className="output-group">
                            <h5>0-10V Outputs</h5>
                            {Array.from({ length: 16 }, (_, i) => i + 1).map(num => (
                              <div key={`uout-${num}`} className="output-item compact">
                                <span>O{num}</span>
                                <input
                                  type="text"
                                  placeholder={`Output ${num} name`}
                                  value={config.outputs[num]?.name || ''}
                                  onChange={(e) => handleBoardConfigChange(index, `output_${num}_name`, e.target.value)}
                                />
                                <Switch
                                  checked={config.outputs[num]?.enabled || false}
                                  onCheckedChange={(checked) => handleBoardConfigChange(index, `output_${num}_enabled`, checked)}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              
              <div className="board-actions">
                <button 
                  className="btn-save"
                  onClick={async () => {
                    try {
                      const response = await authenticatedFetch('/api/logic/boards', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(boardConfigs)
                      });
                      if (response.ok) {
                        alert('Board configuration saved successfully');
                      } else {
                        alert('Failed to save board configuration');
                      }
                    } catch (error) {
                      console.error('Error saving board config:', error);
                      alert('Error saving board configuration');
                    }
                  }}
                >
                  Save Configuration
                </button>
              </div>
            </div>
          )}

          {activeTab === 'status' && (
            <div className="status-section">
              <h2>BMS Connection Status</h2>
              
              <div className="status-header">
                <div className="connection-toggle">
                  <button
                    className={`toggle-btn ${bmsEnabled ? 'enabled' : 'disabled'}`}
                    onClick={toggleBMSConnection}
                  >
                    {bmsEnabled ? <Wifi size={24} /> : <WifiOff size={24} />}
                    <span>{bmsEnabled ? 'Connected' : 'Disconnected'}</span>
                  </button>
                </div>
                
                <div className="bms-address">
                  <Server size={20} />
                  <span>BMS Server: 143.198.162.31</span>
                </div>
              </div>

              <div className="status-grid">
                <div className="status-card">
                  <h3>Connection Status</h3>
                  <div className={`status-indicator ${bmsStatus.connected ? 'connected' : 'disconnected'}`}>
                    {bmsStatus.connected ? <CheckCircle size={32} /> : <XCircle size={32} />}
                    <span>{bmsStatus.connected ? 'Connected' : 'Disconnected'}</span>
                  </div>
                </div>

                <div className="status-card">
                  <h3>Connection Details</h3>
                  <div className="status-details">
                    <div className="detail-row">
                      <span>Last Ping:</span>
                      <span>{bmsStatus.lastPing}</span>
                    </div>
                    <div className="detail-row">
                      <span>Latency:</span>
                      <span>{bmsStatus.latency}ms</span>
                    </div>
                    <div className="detail-row">
                      <span>Logic Source:</span>
                      <span className={`source-badge ${bmsStatus.logicFileStatus}`}>
                        {bmsStatus.usingLocalFile ? 'Local File' : 'Remote Server'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="status-card">
                  <h3>Failover Status</h3>
                  <div className="failover-info">
                    {bmsStatus.usingLocalFile ? (
                      <div className="failover-active">
                        <AlertTriangle size={24} color="#f59e0b" />
                        <p>Using local logic file due to connection failure</p>
                      </div>
                    ) : (
                      <div className="failover-standby">
                        <CheckCircle size={24} color="#10b981" />
                        <p>Connected to remote server</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="status-card">
                  <h3>Node-RED Integration</h3>
                  <div className="integration-status">
                    <div className="detail-row">
                      <span>Command Retrieval:</span>
                      <span className={bmsStatus.connected ? 'active' : 'inactive'}>
                        {bmsStatus.connected ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span>Logic File:</span>
                      <span>{bmsStatus.logicFileStatus !== 'none' ? 'Loaded' : 'Not Loaded'}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="audit-section">
              <div className="audit-controls">
                <h2>Audit Trail</h2>
                <div className="time-selector">
                  <label>Time Range:</label>
                  <select 
                    value={timeRange} 
                    onChange={(e) => setTimeRange(Number(e.target.value))}
                  >
                    <option value={1}>Last Hour</option>
                    <option value={6}>Last 6 Hours</option>
                    <option value={24}>Last 24 Hours</option>
                    <option value={72}>Last 3 Days</option>
                    <option value={168}>Last Week</option>
                    <option value={720}>Last Month</option>
                  </select>
                </div>
              </div>

              {loading ? (
                <div className="loading">Loading audit logs...</div>
              ) : auditLogs.length === 0 ? (
                <div className="no-data">
                  <FileText size={48} color="#9ca3af" />
                  <h3>No Audit Logs</h3>
                  <p>No activity recorded in the selected time range</p>
                </div>
              ) : (
                <div className="audit-table-wrapper">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>User</th>
                        <th>Action</th>
                        <th>Resource</th>
                        <th>IP Address</th>
                        <th>Status</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map(log => (
                        <tr key={log.id}>
                          <td className="time-cell">
                            {new Date(log.timestamp).toLocaleString('en-US', {
                              timeZone: 'America/New_York',
                              month: '2-digit',
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </td>
                          <td className="user-cell">
                            <span className="username">{log.username}</span>
                          </td>
                          <td className="action-cell">
                            <span className="action-badge">
                              {getActionIcon(log.action || '')} {log.action || 'Unknown'}
                            </span>
                          </td>
                          <td className="resource-cell">{log.resource || '-'}</td>
                          <td className="ip-cell">
                            <code>{log.ip_address || 'Unknown'}</code>
                          </td>
                          <td className="status-cell">
                            <span 
                              className="status-badge"
                              style={{ color: getStatusColor(log.status || '') }}
                            >
                              {log.status || 'unknown'}
                            </span>
                          </td>
                          <td className="details-cell">
                            {log.details && (
                              <span className="details" title={log.details}>
                                {log.details.substring(0, 50)}
                                {log.details.length > 50 && '...'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pid' && (
            <div className="pid-section">
              <h2>PID Controllers - 0-10V Actuator Control</h2>
              
              {pidControllers.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  background: '#f9fafb',
                  borderRadius: '8px',
                  border: '2px dashed #d1d5db',
                  margin: '20px 0'
                }}>
                  <h3 style={{ color: '#6b7280', marginBottom: '10px' }}>No PID Controllers Configured</h3>
                  <p style={{ color: '#9ca3af' }}>
                    Upload a hardware configuration HTML file in the Logic Engine tab to automatically configure PID controllers
                    based on your equipment's analog outputs (valves, VFDs, dampers, etc.)
                  </p>
                </div>
              ) : (
              <>
              {parsedHardwareConfig && (
                <div style={{
                  padding: '15px',
                  background: '#f0fdf4',
                  border: '1px solid #10b981',
                  borderRadius: '6px',
                  marginBottom: '20px'
                }}>
                  <p style={{ margin: 0, color: '#065f46', fontWeight: 500 }}>
                    ✓ Auto-configured {pidControllers.length} PID controller{pidControllers.length > 1 ? 's' : ''} from hardware configuration
                  </p>
                  <small style={{ color: '#6b7280' }}>
                    Controllers configured for: {pidControllers.map(c => c.outputChannel).join(', ')}
                  </small>
                </div>
              )}
              
              <div className="pid-controllers">
                {pidControllers.map((controller, index) => (
                  <div key={index} className="pid-card">
                    <div className="pid-header">
                      <h3>{controller.name}</h3>
                      <div className="pid-toggle">
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={controller.enabled}
                            onChange={(e) => updatePIDController(index, 'enabled', e.target.checked)}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                        <span className="toggle-label">
                          {controller.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </div>
                    
                    <div className="pid-params">
                      <div className="param-row">
                        <label>Setpoint (°F):</label>
                        <input
                          type="number"
                          value={controller.setpoint || 45}
                          onChange={(e) => updatePIDController(index, 'setpoint', parseFloat(e.target.value))}
                          min="40"
                          max="100"
                          step="0.5"
                        />
                      </div>
                      
                      <div className="param-group">
                        <h4>PID Tuning</h4>
                        <div className="param-row">
                          <label>Kp (Proportional):</label>
                          <input
                            type="number"
                            value={controller.kp || 2.5}
                            onChange={(e) => updatePIDController(index, 'kp', parseFloat(e.target.value))}
                            min="0"
                            max="10"
                            step="0.1"
                          />
                        </div>
                        <div className="param-row">
                          <label>Ki (Integral):</label>
                          <input
                            type="number"
                            value={controller.ki || 0.15}
                            onChange={(e) => updatePIDController(index, 'ki', parseFloat(e.target.value))}
                            min="0"
                            max="5"
                            step="0.1"
                          />
                        </div>
                        <div className="param-row">
                          <label>Kd (Derivative):</label>
                          <input
                            type="number"
                            value={controller.kd || 0.05}
                            onChange={(e) => updatePIDController(index, 'kd', parseFloat(e.target.value))}
                            min="0"
                            max="2"
                            step="0.01"
                          />
                        </div>
                      </div>
                      
                      <div className="param-group">
                        <h4>Output Limits (0-10V)</h4>
                        <div className="param-row">
                          <label>Min Voltage:</label>
                          <div className="voltage-input">
                            <input
                              type="number"
                              value={controller.outputMin || 0}
                              onChange={(e) => updatePIDController(index, 'outputMin', parseFloat(e.target.value))}
                              min="0"
                              max="10"
                              step="0.1"
                            />
                            <span className="voltage-unit">V ({((controller.outputMin || 0) * 10).toFixed(0)}%)</span>
                          </div>
                        </div>
                        <div className="param-row">
                          <label>Max Voltage:</label>
                          <div className="voltage-input">
                            <input
                              type="number"
                              value={controller.outputMax || 10}
                              onChange={(e) => updatePIDController(index, 'outputMax', parseFloat(e.target.value))}
                              min="0"
                              max="10"
                              step="0.1"
                            />
                            <span className="voltage-unit">V ({((controller.outputMax || 10) * 10).toFixed(0)}%)</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="param-group">
                        <h4>Control Action</h4>
                        <div className="action-toggle">
                          <button
                            className={`action-btn ${!controller.reverseActing ? 'active' : ''}`}
                            onClick={() => updatePIDController(index, 'reverseActing', false)}
                          >
                            Direct Acting
                          </button>
                          <button
                            className={`action-btn ${controller.reverseActing ? 'active' : ''}`}
                            onClick={() => updatePIDController(index, 'reverseActing', true)}
                          >
                            Reverse Acting
                          </button>
                        </div>
                        <div className="action-help">
                          {controller.reverseActing ? (
                            <p>Reverse: Output decreases as process variable increases (heating)</p>
                          ) : (
                            <p>Direct: Output increases as process variable increases (cooling)</p>
                          )}
                        </div>
                      </div>
                      
                      <div className="output-display">
                        <h4>Current Output</h4>
                        <div className="output-value">
                          <span className="voltage">{(controller.currentOutput || 0).toFixed(2)}V</span>
                          <span className="percentage">({((controller.currentOutput || 0) * 10).toFixed(0)}%)</span>
                        </div>
                        <div className="output-bar">
                          <div
                            className="output-fill"
                            style={{ width: `${(controller.currentOutput || 0) * 10}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="pid-actions">
                <button
                  className="btn-save"
                  onClick={async () => {
                    try {
                      // Save all PID controllers to backend
                      for (const controller of pidControllers) {
                        await authenticatedFetch('/api/pid-controllers/save', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(controller)
                        });
                      }
                      alert('PID configuration saved successfully!');
                    } catch (error) {
                      console.error('Error saving PID configuration:', error);
                      alert('Failed to save PID configuration');
                    }
                  }}
                >
                  Save Configuration
                </button>
                <button
                  className="btn-reset"
                  onClick={() => {
                    if (confirm('Reset all PID controllers to default values?')) {
                      const resetControllers = pidControllers.map(c => ({
                        ...c,
                        kp: 0.5,
                        ki: 0.02,
                        kd: 0.01,
                        setpoint: 75,
                        outputMin: 2.6,
                        outputMax: 4.8
                      }));
                      setPidControllers(resetControllers);
                      alert('PID controllers reset to defaults');
                    }
                  }}
                >
                  Reset to Defaults
                </button>
              </div>
              </>
              )}
            </div>
          )}

          {activeTab === 'status' && (
            <div className="bms-status-section">
              <h2>BMS Connection Status</h2>
              
              <div className="status-cards">
                {/* Connection Status Card */}
                <div className="status-card">
                  <h3>System Status</h3>
                  <div className="status-item">
                    <span className="status-label">Connection:</span>
                    <span className={`status-value ${bmsStatus.connected ? 'connected' : 'disconnected'}`}>
                      {bmsStatus.connected ? '● Connected' : '○ Disconnected'}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Last Ping:</span>
                    <span className="status-value">{bmsStatus.lastPing}</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Latency:</span>
                    <span className="status-value">{bmsStatus.latency}ms</span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Logic File:</span>
                    <span className="status-value">
                      {logicContent ? 'Loaded' : 'Not Loaded'}
                    </span>
                  </div>
                </div>

                {/* Node-RED Integration Card */}
                <div className="status-card" style={{ 
                  border: nodeRedIntegrationEnabled ? '2px solid #10b981' : '2px solid #e5e7eb' 
                }}>
                  <h3>Node-RED Integration</h3>
                  <div className="status-item">
                    <span className="status-label">Command Retrieval:</span>
                    <span className={`status-value ${nodeRedIntegrationEnabled ? 'enabled' : 'disabled'}`}>
                      {nodeRedIntegrationEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  
                  <div style={{ 
                    marginTop: '20px', 
                    padding: '15px', 
                    background: nodeRedIntegrationEnabled ? '#f0fdf4' : '#f9fafb',
                    borderRadius: '6px' 
                  }}>
                    <p style={{ marginBottom: '15px', color: '#6b7280' }}>
                      {nodeRedIntegrationEnabled 
                        ? 'Node-RED is actively polling for commands and sending data to the BMS system.'
                        : 'Node-RED integration is disabled. The system is using local logic execution.'}
                    </p>
                    
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <label style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: '10px',
                        fontWeight: 500,
                        color: '#374151'
                      }}>
                        <span>Enable Node-RED Command Retrieval</span>
                        <label className="toggle-switch">
                          <input
                            type="checkbox"
                            checked={nodeRedIntegrationEnabled}
                            onChange={async (e) => {
                              const newState = e.target.checked;
                              setNodeRedIntegrationEnabled(newState);
                              
                              // Save state to backend
                              try {
                                await authenticatedFetch('/api/logic/node-red-toggle', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ enabled: newState })
                                });
                                
                                if (newState) {
                                  alert('Node-RED integration enabled. Commands will be retrieved from Node-RED flows.');
                                } else {
                                  alert('Node-RED integration disabled. Using local logic execution.');
                                }
                              } catch (error) {
                                console.error('Failed to toggle Node-RED integration:', error);
                              }
                            }}
                          />
                          <span className="toggle-slider"></span>
                        </label>
                      </label>
                      
                      {nodeRedIntegrationEnabled && (
                        <span style={{ 
                          color: '#10b981', 
                          fontSize: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '5px'
                        }}>
                          <Activity size={14} />
                          Active
                        </span>
                      )}
                    </div>
                    
                    {nodeRedIntegrationEnabled && (
                      <div style={{ 
                        marginTop: '15px',
                        padding: '10px',
                        background: '#d1fae5',
                        borderRadius: '4px',
                        fontSize: '12px',
                        color: '#065f46'
                      }}>
                        <strong>Note:</strong> When enabled, Node-RED flows will override local logic execution. 
                        Disable this if you want to use the Logic Engine for equipment control.
                      </div>
                    )}
                  </div>
                  
                  <div className="status-item" style={{ marginTop: '15px' }}>
                    <span className="status-label">Node-RED URL:</span>
                    <span className="status-value">
                      <a href="/node-red" target="_blank" rel="noopener noreferrer" style={{ color: '#0ea5e9' }}>
                        Open Node-RED Editor →
                      </a>
                    </span>
                  </div>
                </div>

                {/* Logic Execution Status Card */}
                <div className="status-card">
                  <h3>Logic Execution</h3>
                  <div className="status-item">
                    <span className="status-label">Mode:</span>
                    <span className="status-value">
                      {nodeRedIntegrationEnabled ? 'Node-RED Control' : 'Local Logic Engine'}
                    </span>
                  </div>
                  <div className="status-item">
                    <span className="status-label">Status:</span>
                    <span className={`status-value ${autoRunEnabled ? 'enabled' : 'disabled'}`}>
                      {autoRunEnabled ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  {autoRunEnabled && (
                    <div className="status-item">
                      <span className="status-label">Interval:</span>
                      <span className="status-value">
                        {pollingInterval >= 60 
                          ? pollingInterval === 60 
                            ? '1 minute' 
                            : `${pollingInterval / 60} minutes`
                          : `${pollingInterval} seconds`}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="notes" style={{ marginTop: '20px' }}>
                <h4>Usage Guidelines:</h4>
                <ul>
                  <li><strong>Node-RED Integration:</strong> Enable when you want to use Node-RED flows for BMS control and monitoring.</li>
                  <li><strong>Local Logic Engine:</strong> Disable Node-RED integration to use uploaded JavaScript logic files for equipment control.</li>
                  <li><strong>Switching Modes:</strong> You can switch between modes at any time. The system will remember your preference.</li>
                  <li><strong>Troubleshooting:</strong> If equipment isn't responding, check which mode is active and ensure the appropriate system is configured.</li>
                </ul>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="feature-placeholder">
              <Lock size={64} color="#14b8a6" />
              <h2>Security Features</h2>
              <div className="placeholder-badge">Feature In Progress</div>
              <p>Advanced security configuration and monitoring tools coming soon.</p>
              <div className="placeholder-features">
                <div className="feature-item">
                  <span className="feature-icon">🔐</span>
                  <span>Two-Factor Authentication</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">🛡️</span>
                  <span>Intrusion Detection</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">🔑</span>
                  <span>API Key Management</span>
                </div>
                <div className="feature-item">
                  <span className="feature-icon">📊</span>
                  <span>Security Analytics</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
};

export default Admin;