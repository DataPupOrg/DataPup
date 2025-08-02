;<Card className="connection-card">
  <div className="card-header">
    <h3>{connection.label}</h3>
    <div style={{ fontSize: '14px', color: '#888' }}>
      {connection.host}:{connection.port}/{connection.database}
    </div>
  </div>

  <div
    style={{
      display: 'flex',
      gap: '8px',
      flexWrap: 'wrap',
      alignItems: 'center',
      marginTop: '4px'
    }}
  >
    {connection.secure && (
      <span
        style={{
          backgroundColor: '#e0f7fa',
          color: '#00796b',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '12px'
        }}
      >
        🔒 Secure
      </span>
    )}
    {connection.readOnly && (
      <span
        style={{
          backgroundColor: '#fff3cd',
          color: '#856404',
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '12px'
        }}
      >
        🟡 Read-Only
      </span>
    )}
  </div>
</Card>
