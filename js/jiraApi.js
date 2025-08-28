class JiraAPI {
    constructor() {
        this.settings = null;
        // Set to false for production - prevents sensitive data logging
        this.DEBUG = false;
    }

    async loadSettings(forceReload = false) {
        if (this.settings && this.settings.jiraUrl && !forceReload) {
            return this.settings;
        }
        
        return new Promise((resolve) => {
            chrome.storage.sync.get({
                jiraType: 'cloud',
                jiraUrl: '',
                username: '',
                includeAssigned: true,
                includeReviewer: true,
                excludedStatuses: 'Done, Closed, Resolved',
                maxTasks: 50
            }, (settings) => {
                this.settings = settings;
                resolve(settings);
            });
        });
    }

    async getCurrentUser() {
        await this.loadSettings();
        
        if (!this.settings.jiraUrl) {
            throw new Error('JIRA URL not configured');
        }

        const baseUrl = this.settings.jiraUrl.replace(/\/$/, '');
        const apiPath = this.settings.jiraType === 'cloud' ? '/rest/api/3/myself' : '/rest/api/2/myself';
        
        try {
            const response = await fetch(`${baseUrl}${apiPath}`, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to get current user: ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            // Production-safe logging - no sensitive data
            console.error('Error fetching current user:', error.message);
            throw error;
        }
    }

    async searchTasks(forceReload = false) {
        await this.loadSettings(forceReload);
        
        if (!this.settings.jiraUrl) {
            throw new Error('JIRA URL not configured');
        }

        const baseUrl = this.settings.jiraUrl.replace(/\/$/, '');
        await this.getCurrentUserKey();
        
        const jqlParts = [];
        
        if (this.settings.includeAssigned) {
            jqlParts.push(`assignee = currentUser()`);
        }
        
        if (this.settings.includeReviewer) {
            if (this.settings.jiraType === 'cloud') {
                jqlParts.push(`"Request participants" = currentUser()`);
            } else {
                jqlParts.push(`reviewer = currentUser()`);
            }
        }
        
        if (jqlParts.length === 0) {
            jqlParts.push(`assignee = currentUser()`);
        }
        
        const excludedStatuses = this.settings.excludedStatuses
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
        
        // Properly escape status names for JQL, handling special characters
        const escapedStatuses = excludedStatuses.map(status => {
            // Escape quotes and backslashes in status names
            const escaped = status.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            return `"${escaped}"`;
        });
        
        const jql = excludedStatuses.length > 0 
            ? `(${jqlParts.join(' OR ')}) AND status NOT IN (${escapedStatuses.join(', ')}) ORDER BY priority DESC, updated DESC`
            : `(${jqlParts.join(' OR ')}) ORDER BY priority DESC, updated DESC`;
        const apiPath = this.settings.jiraType === 'cloud' ? '/rest/api/3/search' : '/rest/api/2/search';
        
        const url = `${baseUrl}${apiPath}?jql=${encodeURIComponent(jql)}&maxResults=${this.settings.maxTasks}&fields=summary,status,priority,assignee,reporter,created,updated,description,issuetype`;

        if (this.DEBUG) {
            console.log('JIRA API Request:', {
                url: url,
                jql: jql,
                settings: this.settings
            });
        }

        try {
            const response = await fetch(url, {
                credentials: 'include',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (this.DEBUG) {
                console.log('JIRA API Response:', {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries())
                });
            }

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                
                try {
                    const errorBody = await response.text();
                    if (this.DEBUG) {
                        console.error('JIRA API Error Body:', errorBody);
                    }
                    
                    // Try to parse as JSON for better error message
                    try {
                        const errorJson = JSON.parse(errorBody);
                        if (errorJson.errorMessages && errorJson.errorMessages.length > 0) {
                            errorMessage = errorJson.errorMessages.join(', ');
                        } else if (errorJson.error) {
                            errorMessage = errorJson.error;
                        }
                    } catch (parseError) {
                        // Use raw body if JSON parsing fails
                        if (errorBody && errorBody.length < 200) {
                            errorMessage += ` - ${errorBody}`;
                        }
                    }
                } catch (bodyError) {
                    if (this.DEBUG) {
                        console.error('Could not read error response body:', bodyError);
                    }
                }
                
                if (response.status === 401) {
                    throw new Error('Not authenticated. Please log in to JIRA first.');
                } else if (response.status === 403) {
                    throw new Error('Access denied. Check your JIRA permissions.');
                } else if (response.status === 404) {
                    throw new Error('JIRA API endpoint not found. Check your JIRA URL.');
                }
                
                throw new Error(`Failed to fetch tasks: ${errorMessage}`);
            }

            const data = await response.json();
            if (this.DEBUG) {
                console.log('JIRA API Success:', {
                    issueCount: data.issues?.length || 0,
                    total: data.total
                });
            }
            
            return this.transformTasks(data.issues);
        } catch (error) {
            if (this.DEBUG) {
                console.error('Error fetching tasks:', {
                    error: error.message,
                    stack: error.stack,
                    url: url,
                    jql: jql
                });
            } else {
                // Production-safe error logging
                console.error('Error fetching tasks:', error.message);
            }
            throw error;
        }
    }

    async getCurrentUserKey() {
        try {
            const user = await this.getCurrentUser();
            return this.settings.jiraType === 'cloud' ? user.accountId : user.key;
        } catch (error) {
            // Production-safe logging
            console.error('Could not get current user, using configured username');
            return this.settings.username;
        }
    }

    transformTasks(issues) {
        const baseUrl = this.settings.jiraUrl.replace(/\/$/, '');
        
        return issues.map(issue => ({
            id: issue.id,
            key: issue.key,
            summary: issue.fields.summary,
            description: issue.fields.description,
            status: {
                name: issue.fields.status.name,
                category: issue.fields.status.statusCategory?.name || 'To Do'
            },
            priority: {
                name: issue.fields.priority?.name || 'Medium',
                id: issue.fields.priority?.id || '3',
                iconUrl: issue.fields.priority?.iconUrl
            },
            assignee: {
                displayName: issue.fields.assignee?.displayName || 'Unassigned',
                avatarUrl: issue.fields.assignee?.avatarUrls?.['24x24']
            },
            reporter: {
                displayName: issue.fields.reporter?.displayName,
                avatarUrl: issue.fields.reporter?.avatarUrls?.['24x24']
            },
            type: {
                name: issue.fields.issuetype?.name || 'Task',
                iconUrl: issue.fields.issuetype?.iconUrl
            },
            created: issue.fields.created,
            updated: issue.fields.updated,
            url: `${baseUrl}/browse/${issue.key}`
        }));
    }

    async testConnection() {
        try {
            await this.loadSettings();
            
            if (!this.settings.jiraUrl) {
                return { success: false, message: 'Please configure JIRA URL first' };
            }

            const user = await this.getCurrentUser();
            return { 
                success: true, 
                message: `Connected as ${user.displayName || user.name}`,
                user: user
            };
        } catch (error) {
            return { 
                success: false, 
                message: error.message || 'Connection failed'
            };
        }
    }
}