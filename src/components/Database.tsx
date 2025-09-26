/*
 * AutomataControls™ Remote Portal
 * Copyright © 2024 AutomataNexus, LLC. All rights reserved.
 * 
 * PROPRIETARY AND CONFIDENTIAL
 * This software is proprietary to AutomataNexus and constitutes valuable 
 * trade secrets. This software may not be copied, distributed, modified, 
 * or disclosed to third parties without prior written authorization from 
 * AutomataNexus. Use of this software is governed by a commercial license
 * agreement. Unauthorized use is strictly prohibited.
 * 
 * AutomataNexusBms Controller Software
 */

import React, { useState, useEffect } from 'react';
import '../styles/database.css';
import './Database.css';

interface DatabaseStats {
  databases: {
    [key: string]: {
      [table: string]: number | undefined;
    };
  };
  archive: {
    count: number;
    size: number;
  };
}

interface TableData {
  headers: string[];
  rows: any[][];
}

const Database: React.FC = () => {
  const [stats, setStats] = useState<DatabaseStats | null>(null);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [queryMode, setQueryMode] = useState(false);
  const [customQuery, setCustomQuery] = useState('');
  const [queryResult, setQueryResult] = useState<any>(null);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc'); // desc = newest first
  const [sortColumn, setSortColumn] = useState<string>('timestamp');

  // Fetch database statistics
  useEffect(() => {
    fetchDatabaseStats();
    const interval = setInterval(fetchDatabaseStats, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchDatabaseStats = async () => {
    try {
      const token = sessionStorage.getItem('authToken');
      console.log('Database stats - Token:', token ? 'exists' : 'null');
      
      if (!token) {
        throw new Error('No authentication token found');
      }
      
      const response = await fetch('/api/database/stats', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to fetch database stats');
      const data = await response.json();
      setStats(data);
      
      // Set default selected database if not set
      if (!selectedDb && data.databases) {
        const firstDb = Object.keys(data.databases)[0];
        if (firstDb) setSelectedDb(firstDb);
      }
    } catch (err) {
      console.error('Error fetching database stats:', err);
      setError('Failed to load database statistics');
    }
  };

  const fetchTableData = async (database: string, table: string, sort?: string, order?: 'asc' | 'desc') => {
    setLoading(true);
    setError('');
    try {
      const token = sessionStorage.getItem('authToken');
      const sortCol = sort || sortColumn;
      const sortOrd = order || sortOrder;
      const response = await fetch(`/api/database/${database}/${table}?limit=100&sort=${sortCol}&order=${sortOrd}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      if (!response.ok) throw new Error('Failed to fetch table data');
      const data = await response.json();
      setTableData(data);
    } catch (err) {
      console.error('Error fetching table data:', err);
      setError('Failed to load table data');
    } finally {
      setLoading(false);
    }
  };

  const executeQuery = async () => {
    if (!customQuery.trim()) return;
    
    setLoading(true);
    setError('');
    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/database/query', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ 
          database: selectedDb,
          query: customQuery 
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Query execution failed');
      }
      
      const data = await response.json();
      setQueryResult(data);
    } catch (err: any) {
      console.error('Error executing query:', err);
      setError(err.message || 'Failed to execute query');
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleTableSelect = (table: string) => {
    setSelectedTable(table);
    // Reset sort to default when selecting a new table
    setSortColumn('timestamp');
    setSortOrder('desc');
    if (selectedDb && table) {
      fetchTableData(selectedDb, table, 'timestamp', 'desc');
    }
  };

  const handleSort = (column: string) => {
    const newOrder = sortColumn === column && sortOrder === 'desc' ? 'asc' : 'desc';
    setSortColumn(column);
    setSortOrder(newOrder);
    if (selectedDb && selectedTable) {
      fetchTableData(selectedDb, selectedTable, column, newOrder);
    }
  };

  const toggleSortOrder = () => {
    const newOrder = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(newOrder);
    if (selectedDb && selectedTable) {
      fetchTableData(selectedDb, selectedTable, sortColumn, newOrder);
    }
  };

  const exportData = async (format: 'csv' | 'json') => {
    if (!selectedDb || !selectedTable) return;
    
    try {
      const response = await fetch(
        `/api/database/export/${selectedDb}/${selectedTable}?format=${format}`
      );
      if (!response.ok) throw new Error('Export failed');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedTable}_${new Date().toISOString()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      setError('Failed to export data');
    }
  };

  const cleanupDatabase = async (database: string, days: number) => {
    if (!confirm(`Delete all ${database} data older than ${days} days?`)) return;
    
    setLoading(true);
    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/database/cleanup', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ database, days })
      });
      
      if (!response.ok) throw new Error('Cleanup failed');
      
      const result = await response.json();
      alert(`Deleted ${result.deletedRows} old records`);
      fetchDatabaseStats();
    } catch (err) {
      console.error('Cleanup error:', err);
      setError('Failed to cleanup database');
    } finally {
      setLoading(false);
    }
  };

  const clearAllMetrics = async () => {
    if (!confirm('WARNING: This will delete ALL metrics data permanently. This cannot be undone. Continue?')) return;
    
    setLoading(true);
    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/database/clear-metrics', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        }
      });
      
      if (!response.ok) throw new Error('Clear metrics failed');
      
      const result = await response.json();
      alert(`Cleared ${result.deletedRows} metrics records`);
      fetchDatabaseStats();
    } catch (err) {
      console.error('Clear metrics error:', err);
      setError('Failed to clear metrics data');
    } finally {
      setLoading(false);
    }
  };

  const clearAllAlarms = async () => {
    if (!confirm('WARNING: This will delete ALL alarm history permanently. This cannot be undone. Continue?')) return;
    
    setLoading(true);
    try {
      const token = sessionStorage.getItem('authToken');
      const response = await fetch('/api/database/clear-alarms', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json' 
        }
      });
      
      if (!response.ok) throw new Error('Clear alarms failed');
      
      const result = await response.json();
      alert(`Cleared ${result.deletedRows} alarm records`);
      fetchDatabaseStats();
    } catch (err) {
      console.error('Clear alarms error:', err);
      setError('Failed to clear alarms data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="database-container">
      <div className="database-header">
        <h1>
          <i className="fas fa-database"></i>
          Database Management
        </h1>
        <div className="header-actions">
          <button 
            className="btn-mode"
            onClick={() => setQueryMode(!queryMode)}
          >
            <i className="fas fa-terminal"></i>
            {queryMode ? 'Table View' : 'Query Mode'}
          </button>
          <button 
            className="btn-refresh"
            onClick={fetchDatabaseStats}
          >
            <i className="fas fa-sync-alt"></i>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <i className="fas fa-exclamation-triangle"></i>
          {error}
        </div>
      )}

      <div className="database-layout">
        {/* Database List */}
        <div className="database-sidebar">
          <h3>Databases</h3>
          {stats && Object.entries(stats.databases).map(([dbName, dbInfo]) => (
            <div 
              key={dbName}
              className={`db-item ${selectedDb === dbName ? 'active' : ''}`}
              onClick={() => setSelectedDb(dbName)}
            >
              <div className="db-item-content">
                <div className="db-name">
                  <i className="fas fa-database"></i>
                  {dbName}
                </div>
                <div className="db-info-right">
                  <span className="db-size">{dbInfo.size && formatBytes(dbInfo.size)}</span>
                  {dbName === 'metrics' && (
                    <button 
                      className="btn-clear-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearAllMetrics();
                      }}
                      title="Clear all metrics data"
                      style={{ 
                        background: '#ef4444', 
                        color: 'white', 
                        border: 'none', 
                        padding: '4px 8px', 
                        borderRadius: '4px',
                        fontSize: '10px',
                        marginRight: '4px'
                      }}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  )}
                  {dbName === 'alarms' && (
                    <button 
                      className="btn-clear-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        clearAllAlarms();
                      }}
                      title="Clear all alarm history"
                      style={{ 
                        background: '#ef4444', 
                        color: 'white', 
                        border: 'none', 
                        padding: '4px 8px', 
                        borderRadius: '4px',
                        fontSize: '10px',
                        marginRight: '4px'
                      }}
                    >
                      <i className="fas fa-trash"></i>
                    </button>
                  )}
                  <button 
                    className="btn-cleanup"
                    onClick={(e) => {
                      e.stopPropagation();
                      cleanupDatabase(dbName, 30);
                    }}
                    title="Clean data older than 30 days"
                  >
                    <i className="fas fa-broom"></i>
                  </button>
                </div>
              </div>
            </div>
          ))}
          
          {/* Archive Stats */}
          {stats?.archive && (
            <div className="archive-stats">
              <h4>Archives</h4>
              <div className="archive-info">
                <span>{stats.archive.count} files</span>
                <span>{formatBytes(stats.archive.size)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div className="database-content">
          {/* Table Selection Buttons */}
          {selectedDb && stats?.databases[selectedDb] && (
            <div className="table-buttons-container">
              <div className="table-buttons">
                {Object.entries(stats.databases[selectedDb])
                  .filter(([key]) => key !== 'size' && 
                                     key !== 'nodered_readings' && 
                                     !key.includes('_backup') &&
                                     !key.includes('sqlite_'))
                  .map(([tableName, rowCount]) => (
                    <button
                      key={tableName}
                      className={`table-button ${selectedTable === tableName ? 'active' : ''}`}
                      onClick={() => handleTableSelect(tableName)}
                    >
                      <i className="fas fa-table"></i>
                      <span className="table-name">{tableName}</span>
                      <span className="row-badge">{rowCount}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
          
          {queryMode ? (
            // Query Mode
            <div className="query-mode">
              <div className="query-editor">
                <h3>SQL Query Editor</h3>
                <div className="query-controls">
                  <select 
                    value={selectedDb} 
                    onChange={(e) => setSelectedDb(e.target.value)}
                    className="db-selector"
                  >
                    <option value="">Select Database</option>
                    {stats && Object.keys(stats.databases).map(db => (
                      <option key={db} value={db}>{db}</option>
                    ))}
                  </select>
                  <button 
                    className="btn-execute"
                    onClick={executeQuery}
                    disabled={!selectedDb || !customQuery || loading}
                  >
                    <i className="fas fa-play"></i>
                    Execute
                  </button>
                </div>
                <textarea
                  className="query-input"
                  value={customQuery}
                  onChange={(e) => setCustomQuery(e.target.value)}
                  placeholder="Enter SQL query (SELECT only for safety)..."
                  rows={10}
                />
              </div>
              
              {queryResult && (
                <div className="query-results">
                  <h3>Query Results</h3>
                  {queryResult.rows && queryResult.rows.length > 0 ? (
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            {Object.keys(queryResult.rows[0]).map(col => (
                              <th key={col}>{col}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.map((row: any, idx: number) => (
                            <tr key={idx}>
                              {Object.values(row).map((val: any, i: number) => (
                                <td key={i}>{String(val)}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p>No results found</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            // Table View Mode
            <div className="table-view">
              {selectedTable && (
                <>
                  <div className="table-header">
                    <h3>{selectedDb} / {selectedTable}</h3>
                    <div className="table-actions">
                      <button
                        onClick={toggleSortOrder}
                        className="btn-sort"
                        title={`Sort ${sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}`}
                        style={{
                          background: '#14b8a6',
                          color: 'white',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          marginRight: '8px'
                        }}
                      >
                        <i className={`fas fa-sort-amount-${sortOrder === 'desc' ? 'down' : 'up'}`}></i>
                        {' '}{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
                      </button>
                      <button onClick={() => exportData('csv')}>
                        <i className="fas fa-file-csv"></i> Export CSV
                      </button>
                      <button onClick={() => exportData('json')}>
                        <i className="fas fa-file-code"></i> Export JSON
                      </button>
                    </div>
                  </div>
                  
                  {loading ? (
                    <div className="loading">
                      <i className="fas fa-spinner fa-spin"></i> Loading...
                    </div>
                  ) : tableData ? (
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            {tableData.headers.map(header => (
                              <th
                                key={header}
                                onClick={() => handleSort(header)}
                                style={{
                                  cursor: 'pointer',
                                  userSelect: 'none',
                                  position: 'relative'
                                }}
                                title={`Click to sort by ${header}`}
                              >
                                {header}
                                {sortColumn === header && (
                                  <span style={{ marginLeft: '5px', fontSize: '12px' }}>
                                    {sortOrder === 'desc' ? '▼' : '▲'}
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData.rows.map((row, idx) => (
                            <tr key={idx}>
                              {row.map((cell, i) => (
                                <td key={i}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="no-data">
                      Select a table to view its data
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Database;