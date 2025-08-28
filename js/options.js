document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    
    document.getElementById('saveBtn').addEventListener('click', saveSettings);
    document.getElementById('testBtn').addEventListener('click', testConnection);
    
    document.getElementById('jiraType').addEventListener('change', (e) => {
        updateUrlPlaceholder(e.target.value);
    });
    
    // Handle quick status buttons
    document.querySelectorAll('.status-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            toggleStatus(e.target.dataset.status);
        });
    });
    
    // Update button states when textarea changes
    document.getElementById('excludedStatuses').addEventListener('input', updateStatusButtons);
});

function loadSettings() {
    chrome.storage.sync.get({
        jiraType: 'cloud',
        jiraUrl: '',
        username: '',
        includeAssigned: true,
        includeReviewer: true,
        excludedStatuses: 'Done, Closed, Resolved',
        maxTasks: 50,
        showPriority: true,
        showStatus: true,
        autoRefresh: true
    }, (settings) => {
        document.getElementById('jiraType').value = settings.jiraType;
        document.getElementById('jiraUrl').value = settings.jiraUrl;
        document.getElementById('username').value = settings.username;
        document.getElementById('includeAssigned').checked = settings.includeAssigned;
        document.getElementById('includeReviewer').checked = settings.includeReviewer;
        document.getElementById('excludedStatuses').value = settings.excludedStatuses;
        document.getElementById('maxTasks').value = settings.maxTasks;
        document.getElementById('showPriority').checked = settings.showPriority;
        document.getElementById('showStatus').checked = settings.showStatus;
        document.getElementById('autoRefresh').checked = settings.autoRefresh;
        
        updateUrlPlaceholder(settings.jiraType);
        updateStatusButtons();
    });
}

function saveSettings() {
    const settings = {
        jiraType: document.getElementById('jiraType').value,
        jiraUrl: document.getElementById('jiraUrl').value.trim(),
        username: document.getElementById('username').value.trim(),
        includeAssigned: document.getElementById('includeAssigned').checked,
        includeReviewer: document.getElementById('includeReviewer').checked,
        excludedStatuses: document.getElementById('excludedStatuses').value,
        maxTasks: parseInt(document.getElementById('maxTasks').value, 10),
        showPriority: document.getElementById('showPriority').checked,
        showStatus: document.getElementById('showStatus').checked,
        autoRefresh: document.getElementById('autoRefresh').checked
    };
    
    if (!settings.jiraUrl) {
        showStatus('Please enter a JIRA URL', 'error');
        return;
    }
    
    if (!settings.jiraUrl.startsWith('http://') && !settings.jiraUrl.startsWith('https://')) {
        settings.jiraUrl = 'https://' + settings.jiraUrl;
    }
    
    try {
        new URL(settings.jiraUrl);
    } catch (e) {
        showStatus('Please enter a valid URL', 'error');
        return;
    }
    
    chrome.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
            showStatus('Failed to save settings: ' + chrome.runtime.lastError.message, 'error');
        } else {
            showStatus('Settings saved successfully!', 'success');
            // Notify all tabs to refresh their tasks
            chrome.runtime.sendMessage({ action: 'settings-updated' }, () => {
                if (chrome.runtime.lastError) {
                    // Options page might be opened standalone, not as extension
                    // Extension context may not be available
                }
            });
        }
    });
}

async function testConnection() {
    const saveBtn = document.getElementById('saveBtn');
    saveBtn.click();
    
    setTimeout(async () => {
        const statusEl = document.getElementById('status');
        statusEl.className = 'status-message';
        statusEl.textContent = 'Testing connection...';
        statusEl.style.display = 'block';
        
        try {
            const script = document.createElement('script');
            script.src = '../js/jiraApi.js';
            document.head.appendChild(script);
            
            await new Promise(resolve => {
                script.onload = resolve;
            });
            
            const api = new JiraAPI();
            const result = await api.testConnection();
            
            if (result.success) {
                showStatus(result.message, 'success');
            } else {
                showStatus(result.message, 'error');
            }
        } catch (error) {
            showStatus('Connection test failed: ' + error.message, 'error');
        }
    }, 500);
}

function updateUrlPlaceholder(jiraType) {
    const urlInput = document.getElementById('jiraUrl');
    if (jiraType === 'cloud') {
        urlInput.placeholder = 'https://your-domain.atlassian.net';
    } else {
        urlInput.placeholder = 'https://jira.your-company.com';
    }
}

function showStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.style.display = 'block';
    
    if (type === 'success') {
        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 3000);
    }
}

function toggleStatus(status) {
    const textarea = document.getElementById('excludedStatuses');
    const currentStatuses = textarea.value
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(s => s);
    
    const index = currentStatuses.findIndex(s => s.toLowerCase() === status.toLowerCase());
    
    if (index === -1) {
        // Add status
        currentStatuses.push(status);
    } else {
        // Remove status
        currentStatuses.splice(index, 1);
    }
    
    textarea.value = currentStatuses.join(', ');
    updateStatusButtons();
}

function updateStatusButtons() {
    const textarea = document.getElementById('excludedStatuses');
    const currentStatuses = textarea.value
        .split(/[,\n]/)
        .map(s => s.trim().toLowerCase())
        .filter(s => s);
    
    document.querySelectorAll('.status-btn').forEach(btn => {
        const btnStatus = btn.dataset.status.toLowerCase();
        if (currentStatuses.includes(btnStatus)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}