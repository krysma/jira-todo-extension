class TaskManager {
    constructor() {
        this.tasks = [];
        this.taskOrder = [];
        this.jiraApi = new JiraAPI();
        this.draggedElement = null;
        this.isLoading = false;
        this.refreshInterval = null;
        this.init();
    }

    async init() {
        await this.loadTaskOrder();
        this.attachEventListeners();
        this.setupMessageListener();
        await this.loadTasks();
        this.setupAutoRefresh();
    }

    attachEventListeners() {
        document.getElementById('refreshBtn').addEventListener('click', () => this.loadTasks());
        document.getElementById('settingsBtn').addEventListener('click', () => {
            chrome.runtime.openOptionsPage();
        });
        
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterTasks(e.target.value);
        });
        
        document.getElementById('filterStatus').addEventListener('change', (e) => {
            this.filterByStatus(e.target.value);
        });
    }

    async loadTasks(forceReload = false) {
        if (this.isLoading) return;
        
        this.isLoading = true;
        this.showLoading(true);
        this.hideError();
        
        try {
            this.tasks = await this.jiraApi.searchTasks(forceReload);
            
            if (this.taskOrder.length === 0) {
                this.taskOrder = this.tasks.map(t => t.key);
            } else {
                const existingKeys = new Set(this.tasks.map(t => t.key));
                this.taskOrder = this.taskOrder.filter(key => existingKeys.has(key));
                
                const newKeys = this.tasks
                    .map(t => t.key)
                    .filter(key => !this.taskOrder.includes(key));
                this.taskOrder.push(...newKeys);
            }
            
            await this.saveTaskOrder();
            this.renderTasks();
            this.updateStats();
            
            if (this.tasks.length === 0) {
                this.showEmptyState();
            }
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
        }
    }

    renderTasks() {
        const container = document.getElementById('taskList');
        container.innerHTML = '';
        
        if (this.tasks.length === 0) {
            this.showEmptyState();
            return;
        }
        
        this.hideEmptyState();
        
        const sortedTasks = this.taskOrder
            .map(key => this.tasks.find(t => t.key === key))
            .filter(Boolean);
        
        sortedTasks.forEach((task, index) => {
            const card = this.createTaskCard(task, index);
            container.appendChild(card);
        });
    }

    createTaskCard(task, index) {
        const card = document.createElement('div');
        card.className = 'task-card';
        card.draggable = true;
        card.dataset.taskKey = task.key;
        card.dataset.index = index;
        
        const priorityClass = this.getPriorityClass(task.priority.name);
        const statusClass = this.getStatusClass(task.status.category);
        
        card.innerHTML = `
            <div class="task-header">
                <div class="task-meta">
                    <span class="task-key">${this.escapeHtml(task.key)}</span>
                    <span class="task-type">${this.escapeHtml(task.type.name)}</span>
                </div>
                <div class="task-priority ${priorityClass}" title="${this.escapeHtml(task.priority.name)} priority">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                    </svg>
                </div>
            </div>
            <h3 class="task-title">${this.escapeHtml(task.summary)}</h3>
            <div class="task-footer">
                <span class="task-status ${statusClass}">${this.escapeHtml(task.status.name)}</span>
                <a href="${this.escapeHtml(task.url)}" target="_blank" class="task-link" title="Open in JIRA">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
                    </svg>
                </a>
            </div>
        `;
        
        card.addEventListener('dragstart', (e) => this.handleDragStart(e));
        card.addEventListener('dragover', (e) => this.handleDragOver(e));
        card.addEventListener('drop', (e) => this.handleDrop(e));
        card.addEventListener('dragend', (e) => this.handleDragEnd(e));
        
        return card;
    }

    handleDragStart(e) {
        this.draggedElement = e.target.closest('.task-card');
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.target.innerHTML);
    }

    handleDragOver(e) {
        if (e.preventDefault) {
            e.preventDefault();
        }
        e.dataTransfer.dropEffect = 'move';
        
        const afterElement = this.getDragAfterElement(e.currentTarget.parentNode, e.clientY);
        const dragging = document.querySelector('.dragging');
        
        if (afterElement == null) {
            e.currentTarget.parentNode.appendChild(dragging);
        } else {
            e.currentTarget.parentNode.insertBefore(dragging, afterElement);
        }
        
        return false;
    }

    handleDrop(e) {
        if (e.stopPropagation) {
            e.stopPropagation();
        }
        
        this.updateTaskOrder();
        return false;
    }

    handleDragEnd(e) {
        e.target.classList.remove('dragging');
        this.draggedElement = null;
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
        
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async updateTaskOrder() {
        const cards = document.querySelectorAll('.task-card');
        this.taskOrder = Array.from(cards).map(card => card.dataset.taskKey);
        await this.saveTaskOrder();
    }

    async saveTaskOrder() {
        return new Promise((resolve) => {
            chrome.storage.local.set({ taskOrder: this.taskOrder }, resolve);
        });
    }

    async loadTaskOrder() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['taskOrder'], (result) => {
                this.taskOrder = result.taskOrder || [];
                resolve();
            });
        });
    }

    filterTasks(searchTerm) {
        const cards = document.querySelectorAll('.task-card');
        const term = searchTerm.toLowerCase();
        
        cards.forEach(card => {
            const title = card.querySelector('.task-title').textContent.toLowerCase();
            const key = card.dataset.taskKey.toLowerCase();
            
            if (title.includes(term) || key.includes(term)) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    }

    filterByStatus(status) {
        const cards = document.querySelectorAll('.task-card');
        
        cards.forEach(card => {
            if (!status) {
                card.style.display = '';
                return;
            }
            
            const cardStatus = card.querySelector('.task-status').textContent.toLowerCase();
            
            if (status === 'todo' && cardStatus.includes('to do')) {
                card.style.display = '';
            } else if (status === 'inprogress' && cardStatus.includes('progress')) {
                card.style.display = '';
            } else if (status === 'review' && cardStatus.includes('review')) {
                card.style.display = '';
            } else {
                card.style.display = 'none';
            }
        });
    }

    updateStats() {
        const count = this.tasks.length;
        document.getElementById('taskCount').textContent = `${count} task${count !== 1 ? 's' : ''}`;
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        document.getElementById('lastUpdate').textContent = `Updated ${timeStr}`;
    }

    setupAutoRefresh() {
        chrome.storage.sync.get(['autoRefresh'], (result) => {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
            
            if (result.autoRefresh !== false) {
                this.refreshInterval = setInterval(() => this.loadTasks(), 5 * 60 * 1000);
            }
        });
    }

    setupMessageListener() {
        // Listen for messages from background script
        chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
            if (request.action === 'reload-tasks') {
                // Message received for task reload
                this.loadTasks(true).then(() => {
                    sendResponse({ reloaded: true });
                }).catch(error => {
                    console.error('Failed to reload tasks:', error.message);
                    sendResponse({ error: error.message });
                });
                return true; // Indicates we will send a response asynchronously
            }
        });
    }

    showLoading(show) {
        document.getElementById('loadingIndicator').classList.toggle('hidden', !show);
        document.getElementById('taskList').classList.toggle('hidden', show);
    }

    showError(message) {
        const errorEl = document.getElementById('errorMessage');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
    }

    hideError() {
        document.getElementById('errorMessage').classList.add('hidden');
    }

    showEmptyState() {
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('taskList').classList.add('hidden');
    }

    hideEmptyState() {
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('taskList').classList.remove('hidden');
    }

    getPriorityClass(priority) {
        const p = priority.toLowerCase();
        if (p.includes('highest') || p.includes('blocker')) return 'priority-highest';
        if (p.includes('high') || p.includes('critical')) return 'priority-high';
        if (p.includes('low') || p.includes('minor')) return 'priority-low';
        if (p.includes('lowest') || p.includes('trivial')) return 'priority-lowest';
        return 'priority-medium';
    }

    getStatusClass(category) {
        const c = category.toLowerCase();
        if (c.includes('done') || c.includes('complete')) return 'status-done';
        if (c.includes('progress')) return 'status-in-progress';
        return 'status-todo';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new TaskManager();
});