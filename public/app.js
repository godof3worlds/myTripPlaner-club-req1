// --- TripWise Frontend Application Logic ---

const state = {
  destinations: [],
  itinerary: [],
  activeCategory: 'all',
  searchQuery: '',
  sortBy: 'rating',
  visibleDestinationCount: 12,
  activeModalDest: null,
  user: null,
  authMode: 'login' // 'login' or 'register'
};

// DOM Elements
const tabExplore = document.getElementById('tab-explore');
const tabItinerary = document.getElementById('tab-itinerary');
const viewExplore = document.getElementById('view-explore');
const viewItinerary = document.getElementById('view-itinerary');
const itineraryBadge = document.getElementById('itinerary-count-badge');

const searchInput = document.getElementById('search-input');
const clearSearchBtn = document.getElementById('clear-search-btn');
const categoryChips = document.getElementById('category-chips');
const sortSelect = document.getElementById('sort-select');

const destinationsGrid = document.getElementById('destinations-grid');
const loadMoreWrap = document.getElementById('load-more-wrap');
const loadMoreDestinations = document.getElementById('load-more-destinations');
const loadMoreCount = document.getElementById('load-more-count');
const resultsCount = document.getElementById('results-count');
const resetFiltersBtn = document.getElementById('reset-filters-btn');
const loadingExplore = document.getElementById('loading-explore');
const errorExplore = document.getElementById('error-explore');
const retryExploreBtn = document.getElementById('retry-explore-btn');
const emptyExplore = document.getElementById('empty-explore');
const emptyResetBtn = document.getElementById('empty-reset-btn');

const itineraryGrid = document.getElementById('itinerary-grid');
const loadingItinerary = document.getElementById('loading-itinerary');
const emptyItinerary = document.getElementById('empty-itinerary');
const statTotalDest = document.getElementById('stat-total-dest');
const statTotalCountries = document.getElementById('stat-total-countries');
const gotoExploreBtn = document.getElementById('goto-explore-btn');
const itineraryChatToggle = document.getElementById('itinerary-chat-toggle');
const itineraryChatPanel = document.getElementById('itinerary-chat-panel');
const itineraryChatStatus = document.getElementById('itinerary-chat-status');
const itineraryChatDestination = document.getElementById('itinerary-chat-destination');
const itineraryChatMessages = document.getElementById('itinerary-chat-messages');
const itineraryChatForm = document.getElementById('itinerary-chat-form');
const itineraryChatInput = document.getElementById('itinerary-chat-input');
const itineraryChatSend = document.getElementById('itinerary-chat-send');
const itineraryChatHistory = [];
let openRouterChatIsConfigured = false;
let nvidiaImageIsConfigured = false;
let isChatSending = false;

const destinationModal = document.getElementById('destination-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalImg = document.getElementById('modal-img');
const modalCategory = document.getElementById('modal-category');
const modalTitle = document.getElementById('modal-title');
const modalLocation = document.getElementById('modal-location');
const modalRating = document.getElementById('modal-rating');
const modalDescription = document.getElementById('modal-description');
const modalWeatherIcon = document.getElementById('modal-weather-icon');
const modalWeatherTemp = document.getElementById('modal-weather-temp');
const modalWeatherCond = document.getElementById('modal-weather-cond');
const modalWeatherFeels = document.getElementById('modal-weather-feels');
const modalWeatherWind = document.getElementById('modal-weather-wind');
const modalPlanDate = document.getElementById('modal-plan-date');
const modalNotes = document.getElementById('modal-notes');
const modalAddBtn = document.getElementById('modal-add-btn');
const modalFormSection = document.querySelector('.modal-form-section');
const modalItineraryMeta = document.getElementById('modal-itinerary-meta');

// Auth DOM Elements
const btnOpenLogin = document.getElementById('btn-open-login');
const userProfilePill = document.getElementById('user-profile-pill');
const userAvatarInitial = document.getElementById('user-avatar-initial');
const userDisplayName = document.getElementById('user-display-name');
const btnLogout = document.getElementById('btn-logout');

const authModal = document.getElementById('auth-modal');
const authModalCloseBtn = document.getElementById('auth-modal-close-btn');
const authModalTitle = document.getElementById('auth-modal-title');
const authModalSubtitle = document.getElementById('auth-modal-subtitle');
const authTabLogin = document.getElementById('auth-tab-login');
const authTabRegister = document.getElementById('auth-tab-register');
const authForm = document.getElementById('auth-form');
const groupName = document.getElementById('group-name');
const authName = document.getElementById('auth-name');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const authFeedbackBanner = document.getElementById('auth-feedback-banner');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authFooterPrompt = document.getElementById('auth-footer-prompt');
const authSwitchLink = document.getElementById('auth-switch-link');

const toastContainer = document.getElementById('toast-container');

// --- Helper: Request Headers with Bearer Token ---
function getAuthHeaders() {
  const token = localStorage.getItem('tripwise_token');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  setupScrollBackgroundVideo();
  setupScrollDrivenWheels();
  setupNavigation();
  setupFilterControls();
  setupModalEvents();
  setupZeroItinerary();
  setupAuthEvents();
  setupItineraryChat();
  fetchConfig();
  checkAuthStatus().then(() => {
    if (state.user) {
      fetchItinerary().then(() => fetchDestinations());
    } else {
      state.itinerary = [];
      updateItineraryBadge();
      fetchDestinations();
    }
  });
});

async function fetchConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const dbLabel = document.getElementById('db-type-label');
    if (dbLabel && data.database) {
      const configured = data.database.configured;
      dbLabel.textContent = configured ? 'Supabase DB' : 'Supabase not configured';
      const statusPill = document.getElementById('db-status-pill');
      if (statusPill) {
        statusPill.classList.toggle('status-live', configured);
        statusPill.title = configured ? 'Supabase configured' : 'Supabase configuration required';
      }
    }
    openRouterChatIsConfigured = Boolean(data.externalApis?.openRouter?.active);
    nvidiaImageIsConfigured = Boolean(data.externalApis?.nvidia?.active);
    updateChatAvailability();
  } catch (e) {
    console.error('Config fetch error', e);
    itineraryChatStatus.textContent = 'AI status unavailable';
    itineraryChatStatus.classList.add('chat-status-error');
  }
}

function setupItineraryChat() {
  itineraryChatForm.addEventListener('submit', handleItineraryChatSubmit);
  itineraryChatDestination.addEventListener('change', () => {
    itineraryChatHistory.length = 0;
    itineraryChatMessages.replaceChildren();
    addChatText('assistant', `What would you like to know about ${getSelectedChatDestination()?.name || 'this place'}? You can also ask me to make a travel poster.`);
  });
  syncChatDestinations();
}

function updateChatAvailability() {
  const hasDestination = itineraryChatDestination.options.length > 0;
  const hasAiProvider = openRouterChatIsConfigured || nvidiaImageIsConfigured;
  const disabled = !hasAiProvider || !hasDestination || isChatSending;
  itineraryChatInput.disabled = disabled;
  itineraryChatSend.disabled = disabled;
  itineraryChatDestination.disabled = !hasDestination || isChatSending;

  if (!hasDestination) {
    itineraryChatStatus.textContent = 'Add a place to start';
    itineraryChatStatus.classList.remove('chat-status-ready', 'chat-status-error');
  } else if (openRouterChatIsConfigured && nvidiaImageIsConfigured) {
    itineraryChatStatus.textContent = 'Chat & posters ready';
    itineraryChatStatus.title = 'OpenRouter chat and NVIDIA NIM image generation are configured.';
    itineraryChatStatus.classList.add('chat-status-ready');
    itineraryChatStatus.classList.remove('chat-status-error');
  } else if (openRouterChatIsConfigured) {
    itineraryChatStatus.textContent = 'Chat ready · poster key needed';
    itineraryChatStatus.title = 'Add NVIDIA_API_KEY_for_Posters to the server .env file to enable generated posters.';
    itineraryChatStatus.classList.add('chat-status-ready');
    itineraryChatStatus.classList.remove('chat-status-error');
  } else if (nvidiaImageIsConfigured) {
    itineraryChatStatus.textContent = 'Posters ready · chat key needed';
    itineraryChatStatus.title = 'Add OPENROUTER_API_KEY to the server .env file to enable text chat.';
    itineraryChatStatus.classList.add('chat-status-ready');
    itineraryChatStatus.classList.remove('chat-status-error');
  } else {
    itineraryChatStatus.textContent = 'AI keys needed';
    itineraryChatStatus.title = 'Configure OPENROUTER_API_KEY for chat and NVIDIA_API_KEY_for_Posters for poster generation.';
    itineraryChatStatus.classList.remove('chat-status-ready');
    itineraryChatStatus.classList.add('chat-status-error');
  }
}

function syncChatDestinations() {
  const previousId = itineraryChatDestination.value;
  itineraryChatDestination.replaceChildren();

  state.itinerary.forEach(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.name}${item.city ? ` · ${item.city}` : ''}`;
    itineraryChatDestination.appendChild(option);
  });

  if (state.itinerary.some(item => item.id === previousId)) {
    itineraryChatDestination.value = previousId;
  }
  if (previousId && itineraryChatDestination.value !== previousId) {
    itineraryChatHistory.length = 0;
    itineraryChatMessages.replaceChildren();
  }
  updateChatAvailability();

  if (state.itinerary.length === 0) {
    itineraryChatHistory.length = 0;
    itineraryChatMessages.replaceChildren();
    addChatText('assistant', 'Add a destination to your itinerary, then choose it here to start chatting or create a poster.');
  } else if (!itineraryChatMessages.childElementCount) {
    addChatText('assistant', `Ask me about ${getSelectedChatDestination()?.name || 'your selected place'}, or ask me to make a travel poster.`);
  }
}

function getSelectedChatDestination() {
  return state.itinerary.find(item => item.id === itineraryChatDestination.value) || null;
}

function addChatText(role, text) {
  const message = document.createElement('div');
  message.className = `itinerary-chat-message itinerary-chat-message-${role}`;
  message.textContent = text;
  itineraryChatMessages.appendChild(message);
  itineraryChatMessages.scrollTop = itineraryChatMessages.scrollHeight;
  return message;
}

function addChatPoster(reply, image, destinationName) {
  const message = addChatText('assistant', reply);
  message.classList.add('itinerary-chat-poster-message');

  const poster = document.createElement('img');
  poster.className = 'itinerary-chat-poster';
  poster.src = image.dataUrl;
  poster.alt = `AI-generated travel poster for ${destinationName}`;
  poster.loading = 'lazy';

  const download = document.createElement('a');
  const extension = image.mediaType === 'image/jpeg' ? 'jpg' : image.mediaType === 'image/webp' ? 'webp' : 'png';
  const filename = destinationName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'destination';
  download.href = image.dataUrl;
  download.download = `tripwise-${filename}-poster.${extension}`;
  download.className = 'btn-secondary itinerary-chat-download';
  download.textContent = 'Download poster';

  message.append(poster, download);
  itineraryChatMessages.scrollTop = itineraryChatMessages.scrollHeight;
}

async function handleItineraryChatSubmit(event) {
  event.preventDefault();
  const destination = getSelectedChatDestination();
  const message = itineraryChatInput.value.trim();
  if (isChatSending || !message || !destination) return;
  const isPosterRequest = /\b(poster|generate(?:\s+me)?\s+(?:an?\s+)?(?:image|artwork|illustration)|create\s+(?:an?\s+)?(?:image|artwork|illustration)|make\s+(?:an?\s+)?(?:image|artwork|illustration)|draw|illustrate)\b/i.test(message);
  if ((isPosterRequest && !nvidiaImageIsConfigured) || (!isPosterRequest && !openRouterChatIsConfigured)) {
    addChatText('assistant', isPosterRequest
      ? 'Poster generation needs an NVIDIA NIM key. Add NVIDIA_API_KEY_for_Posters to the server .env file and restart TripWise.'
      : 'AI chat needs an OpenRouter key. Add OPENROUTER_API_KEY to the server .env file and restart TripWise.');
    return;
  }

  const history = itineraryChatHistory.slice(-10);
  addChatText('user', message);
  itineraryChatInput.value = '';
  isChatSending = true;
  updateChatAvailability();
  const pending = addChatText('assistant', isPosterRequest ? 'Creating your poster…' : 'Thinking…');
  pending.classList.add('itinerary-chat-pending');
  itineraryChatPanel.setAttribute('aria-busy', 'true');

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        destinationId: destination.id,
        message,
        history
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI request failed');
    pending.remove();

    if (result.type === 'image' && result.image?.dataUrl && result.image?.mediaType) {
      itineraryChatHistory.push({ role: 'user', content: message });
      addChatPoster(result.reply, result.image, destination.name);
      itineraryChatHistory.push({ role: 'assistant', content: result.reply });
    } else if (result.type === 'text' && typeof result.reply === 'string') {
      itineraryChatHistory.push({ role: 'user', content: message });
      addChatText('assistant', result.reply);
      itineraryChatHistory.push({ role: 'assistant', content: result.reply });
    } else {
      throw new Error('The AI returned an unexpected response. Please try again.');
    }
  } catch (error) {
    pending.remove();
    addChatText('assistant', error.message || 'Could not reach the AI. Please try again.');
  } finally {
    isChatSending = false;
    itineraryChatPanel.removeAttribute('aria-busy');
    updateChatAvailability();
    itineraryChatInput.focus();
  }
}

// --- Authentication Handling ---
function setupAuthEvents() {
  btnOpenLogin.addEventListener('click', () => openAuthModal('login'));
  authModalCloseBtn.addEventListener('click', closeAuthModal);
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });

  authTabLogin.addEventListener('click', () => switchAuthMode('login'));
  authTabRegister.addEventListener('click', () => switchAuthMode('register'));
  authSwitchLink.addEventListener('click', () => {
    switchAuthMode(state.authMode === 'login' ? 'register' : 'login');
  });

  authForm.addEventListener('submit', handleAuthSubmit);
  btnLogout.addEventListener('click', handleLogout);
}

function openAuthModal(mode = 'login') {
  switchAuthMode(mode);
  authFeedbackBanner.style.display = 'none';
  authFeedbackBanner.textContent = '';
  authPassword.value = '';
  authModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  authEmail.focus();
}

function closeAuthModal() {
  authModal.style.display = 'none';
  document.body.style.overflow = '';
}

function switchAuthMode(mode) {
  state.authMode = mode;
  authFeedbackBanner.style.display = 'none';

  if (mode === 'login') {
    authTabLogin.classList.add('active');
    authTabRegister.classList.remove('active');
    authModalTitle.textContent = 'Welcome Back';
    authModalSubtitle.textContent = 'Sign in to access your personal travel itineraries.';
    groupName.style.display = 'none';
    authSubmitBtn.textContent = 'Sign In';
    authFooterPrompt.textContent = "Don't have an account?";
    authSwitchLink.textContent = 'Create one';
  } else {
    authTabRegister.classList.add('active');
    authTabLogin.classList.remove('active');
    authModalTitle.textContent = 'Create Account';
    authModalSubtitle.textContent = 'Sign up to start planning trips with zero clutter.';
    groupName.style.display = 'flex';
    authSubmitBtn.textContent = 'Create Account';
    authFooterPrompt.textContent = 'Already have an account?';
    authSwitchLink.textContent = 'Sign in';
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  authFeedbackBanner.style.display = 'none';

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const name = authName.value.trim();

  if (!email || !email.includes('@')) {
    showAuthError('Please enter a valid email address');
    return;
  }
  if (!password || password.length < 6) {
    showAuthError('Password must be at least 6 characters');
    return;
  }

  authSubmitBtn.disabled = true;
  authSubmitBtn.textContent = 'Processing...';

  try {
    const endpoint = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const bodyPayload = state.authMode === 'login' ? { email, password } : { email, password, name };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Authentication failed');

    // Save token securely in client storage
    localStorage.setItem('tripwise_token', data.token);
    state.user = data.user;
    updateAuthUI();
    closeAuthModal();

    showToast(
      state.authMode === 'login' ? `Welcome back, ${data.user.name}!` : `Welcome to TripWise, ${data.user.name}!`,
      'success'
    );

    // Refresh itinerary for current authenticated user (new user starts clean with zero items)
    await fetchItinerary();
    renderDestinations();
  } catch (err) {
    showAuthError(err.message);
  } finally {
    authSubmitBtn.disabled = false;
    authSubmitBtn.textContent = state.authMode === 'login' ? 'Sign In' : 'Create Account';
  }
}

function showAuthError(msg) {
  authFeedbackBanner.textContent = msg;
  authFeedbackBanner.style.display = 'block';
}

async function checkAuthStatus() {
  const token = localStorage.getItem('tripwise_token');
  if (!token) {
    state.user = null;
    updateAuthUI();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.authenticated && data.user) {
      state.user = data.user;
    } else {
      localStorage.removeItem('tripwise_token');
      state.user = null;
    }
  } catch (err) {
    state.user = null;
  }
  updateAuthUI();
}

function updateAuthUI() {
  if (state.user) {
    btnOpenLogin.style.display = 'none';
    userProfilePill.style.display = 'flex';
    userAvatarInitial.textContent = (state.user.name || state.user.email)[0].toUpperCase();
    userDisplayName.textContent = state.user.name || state.user.email.split('@')[0];
  } else {
    btnOpenLogin.style.display = 'inline-flex';
    userProfilePill.style.display = 'none';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
  } catch (e) {
    // Continue local cleanup
  }
  localStorage.removeItem('tripwise_token');
  state.user = null;
  state.itinerary = [];
  updateItineraryBadge();
  updateAuthUI();
  showToast('Signed out of TripWise', 'info');

  renderItinerary();
  renderDestinations();
}

// --- Itinerary Zeroing ---
function setupZeroItinerary() {
  const zeroBtn = document.getElementById('btn-zero-itinerary');
  if (!zeroBtn) return;
  zeroBtn.addEventListener('click', async () => {
    if (state.itinerary.length === 0) {
      showToast('Itinerary is already empty', 'info');
      return;
    }
    const confirmed = window.confirm('Are you sure you want to zero out and clear all your itinerary items from the database?');
    if (!confirmed) return;

    try {
      const res = await fetch('/api/itinerary/zero', {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to zero database');

      state.itinerary = [];
      updateItineraryBadge();
      renderItinerary();
      renderDestinations();
      showToast('Itinerary zeroed out & verified with database', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

// --- Navigation Tabs ---
function setupNavigation() {
  tabExplore.addEventListener('click', () => switchTab('explore'));
  tabItinerary.addEventListener('click', () => {
    if (!state.user) {
      openAuthModal('login');
      showToast('Sign in to view your personal itinerary', 'info');
      return;
    }
    switchTab('itinerary');
  });
  gotoExploreBtn.addEventListener('click', () => switchTab('explore'));
  document.getElementById('brand-logo').addEventListener('click', () => switchTab('explore'));
  itineraryChatToggle.addEventListener('click', () => {
    const isOpen = itineraryChatToggle.getAttribute('aria-expanded') === 'true';
    itineraryChatToggle.setAttribute('aria-expanded', String(!isOpen));
    itineraryChatPanel.hidden = isOpen;
  });
}

function switchTab(target) {
  if (target === 'explore') {
    tabExplore.classList.add('active');
    tabItinerary.classList.remove('active');
    viewExplore.classList.add('active');
    viewItinerary.classList.remove('active');
  } else {
    tabItinerary.classList.add('active');
    tabExplore.classList.remove('active');
    viewItinerary.classList.add('active');
    viewExplore.classList.remove('active');
    renderItinerary();
  }
}

// --- Filter & Search Controls ---
function setupFilterControls() {
  let searchTimeout = null;
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      fetchDestinations();
    }, 300);
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.style.display = 'none';
    fetchDestinations();
  });

  categoryChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.activeCategory = chip.dataset.category;
    fetchDestinations();
  });

  sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    fetchDestinations();
  });

  const resetAll = () => {
    searchInput.value = '';
    state.searchQuery = '';
    clearSearchBtn.style.display = 'none';
    state.activeCategory = 'all';
    document.querySelectorAll('.chip').forEach(c => {
      c.classList.toggle('active', c.dataset.category === 'all');
    });
    sortSelect.value = 'rating';
    state.sortBy = 'rating';
    fetchDestinations();
  };

  resetFiltersBtn.addEventListener('click', resetAll);
  emptyResetBtn.addEventListener('click', resetAll);
  retryExploreBtn.addEventListener('click', fetchDestinations);
  loadMoreDestinations.addEventListener('click', () => {
    state.visibleDestinationCount += 12;
    renderDestinations();
  });
}

// --- Fetch Destinations from API ---
async function fetchDestinations() {
  state.visibleDestinationCount = 12;
  loadingExplore.style.display = 'block';
  errorExplore.style.display = 'none';
  emptyExplore.style.display = 'none';
  loadMoreWrap.style.display = 'none';
  destinationsGrid.innerHTML = '';
  resultsCount.textContent = 'Searching destinations...';

  try {
    const params = new URLSearchParams();
    if (state.searchQuery) params.append('q', state.searchQuery);
    if (state.activeCategory && state.activeCategory !== 'all') params.append('category', state.activeCategory);
    if (state.sortBy) params.append('sortBy', state.sortBy);

    const res = await fetch(`/api/destinations?${params.toString()}`);
    if (!res.ok) throw new Error(`Server returned HTTP ${res.status}`);
    const data = await res.json();

    state.destinations = data.data || [];
    loadingExplore.style.display = 'none';

    const hasFilter = state.searchQuery !== '' || state.activeCategory !== 'all';
    resetFiltersBtn.style.display = hasFilter ? 'inline-block' : 'none';

    renderDestinations();
  } catch (err) {
    console.error('Fetch destinations error:', err);
    loadingExplore.style.display = 'none';
    errorExplore.style.display = 'flex';
    resultsCount.textContent = 'Error loading destinations';
  }
}

// --- Render Destinations Grid ---
function renderDestinations() {
  const total = state.destinations.length;
  const visibleDestinations = state.destinations.slice(0, state.visibleDestinationCount);
  const remaining = total - visibleDestinations.length;
  resultsCount.textContent = remaining > 0
    ? `Showing ${visibleDestinations.length} of ${total} destinations`
    : `Showing ${total} destination${total === 1 ? '' : 's'}`;
  renderHeroSpotlight();

  if (total === 0) {
    emptyExplore.style.display = 'block';
    destinationsGrid.innerHTML = '';
    loadMoreWrap.style.display = 'none';
    return;
  }

  emptyExplore.style.display = 'none';

  destinationsGrid.innerHTML = visibleDestinations.map(dest => {
    const isAdded = state.itinerary.some(item => item.destination_id === dest.id || item.id === dest.id);
    const weather = dest.weather;
    const weatherTitle = weather
      ? `Current weather from Open-Meteo${weather.observed_at ? `, observed at ${weather.observed_at}` : ''}`
      : 'Current weather is unavailable';

    return `
      <article class="dest-card" data-id="${dest.id}">
        <div class="dest-card-media">
          <img src="${dest.image_url}" alt="${escapeHtml(dest.name)}" class="dest-card-img" loading="lazy">
          <span class="category-pill">${escapeHtml(dest.category)}</span>
          ${dest.image_credit_url ? `<a class="image-credit" href="${escapeHtml(dest.image_credit_url)}" target="_blank" rel="noopener noreferrer" title="Image attribution and license" aria-label="Image credit: ${escapeHtml(dest.image_credit || 'Wikimedia Commons')}">${escapeHtml(dest.image_credit || 'Wikimedia Commons')}</a>` : ''}
          <div class="weather-chip ${weather ? '' : 'weather-unavailable'}" title="${escapeHtml(weatherTitle)}">
            <span class="weather-chip-icon">${weather ? weather.icon : '⚠️'}</span>
            <span class="weather-chip-copy">
              <span class="weather-chip-temp">${weather ? `${weather.temp}°C` : 'Unavailable'}</span>
              <span class="weather-chip-condition">${weather ? escapeHtml(weather.condition) : 'Weather offline'}</span>
            </span>
            ${weather ? '<span class="weather-chip-live">CURRENT</span>' : ''}
          </div>
        </div>

        <div class="dest-card-content">
          <div class="dest-card-header">
            <h3 class="dest-card-title">${escapeHtml(dest.name)}</h3>
            <span class="dest-card-rating">⭐ ${dest.rating.toFixed(1)}</span>
          </div>

          <p class="dest-card-location">📍 ${escapeHtml(dest.city)}, ${escapeHtml(dest.country)}</p>
          <p class="dest-card-desc">${escapeHtml(dest.description)}</p>

          <div class="dest-card-footer">
            <button class="btn-secondary btn-details" data-id="${dest.id}">Details</button>
            <button class="btn-primary btn-add-trip ${isAdded ? 'btn-added' : ''}" data-id="${dest.id}">
              ${isAdded ? '✓ Added' : '+ Add to Trip'}
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  destinationsGrid.querySelectorAll('.image-credit').forEach(link => {
    link.addEventListener('click', e => e.stopPropagation());
  });

  destinationsGrid.querySelectorAll('.btn-details').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(btn.dataset.id);
    });
  });

  destinationsGrid.querySelectorAll('.btn-add-trip').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const destId = btn.dataset.id;
      const isAdded = state.itinerary.some(item => item.destination_id === destId || item.id === destId);
      if (isAdded) {
        showToast('Already added to your itinerary', 'info');
        return;
      }
      quickAddToItinerary(destId, btn.getBoundingClientRect());
    });
  });

  destinationsGrid.querySelectorAll('.dest-card').forEach(card => {
    card.addEventListener('click', () => {
      openModal(card.dataset.id);
    });
  });

  loadMoreWrap.style.display = remaining > 0 ? 'flex' : 'none';
  if (remaining > 0) {
    loadMoreDestinations.textContent = `Show ${Math.min(12, remaining)} more destinations`;
    loadMoreCount.textContent = `${remaining} remaining`;
  }
}

function renderHeroSpotlight() {
  const destination = state.destinations.find(item => item.image_url);
  if (!destination) return;

  const image = document.getElementById('hero-spotlight-img');
  const title = document.getElementById('hero-spotlight-title');
  const location = document.getElementById('hero-spotlight-location');
  const weather = document.getElementById('hero-spotlight-weather');

  image.src = destination.image_url;
  image.alt = `${destination.name}, ${destination.city}`;
  title.textContent = destination.name;
  location.textContent = `${destination.city}, ${destination.country}`;
  weather.textContent = destination.weather
    ? `${destination.weather.icon} ${destination.weather.temp}°C · ${destination.weather.condition}`
    : 'Current weather unavailable';
}

// --- Quick Add from Card ---
async function quickAddToItinerary(destId, sourceRect) {
  if (!state.user) {
    openAuthModal('login');
    showToast('Sign in to save destinations to your itinerary', 'info');
    return;
  }

  const dest = state.destinations.find(d => d.id === destId);
  if (!dest) return;

  try {
    const res = await fetch('/api/itinerary', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        destination_id: dest.id,
        name: dest.name,
        city: dest.city,
        country: dest.country,
        category: dest.category,
        description: dest.description,
        rating: dest.rating,
        image_url: dest.image_url,
        notes: '',
        planned_date: ''
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add item');

    state.itinerary.unshift(data.data);
    updateItineraryBadge();
    renderDestinations();
    animateJetsIntoItinerary(sourceRect);
    showToast(`Added ${dest.name} to itinerary!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Fetch Itinerary from Database ---
async function fetchItinerary() {
  if (!state.user) {
    state.itinerary = [];
    updateItineraryBadge();
    renderItinerary();
    return;
  }

  loadingItinerary.style.display = 'block';
  try {
    const res = await fetch('/api/itinerary', { headers: getAuthHeaders() });
    if (!res.ok) throw new Error('Database fetch failed');
    const data = await res.json();
    state.itinerary = data.data || [];
    updateItineraryBadge();
  } catch (err) {
    console.error('Error fetching itinerary:', err);
    showToast('Could not load itinerary data', 'error');
  } finally {
    loadingItinerary.style.display = 'none';
  }
}

// --- Update Itinerary Badge & Stats ---
function updateItineraryBadge() {
  const count = state.itinerary.length;
  itineraryBadge.textContent = count;
  statTotalDest.textContent = count;
  syncChatDestinations();

  const uniqueCountries = new Set(
    state.itinerary.map(i => i.country).filter(Boolean)
  );
  statTotalCountries.textContent = uniqueCountries.size;
}

// --- Render Itinerary Grid ---
function renderItinerary() {
  updateItineraryBadge();

  if (state.itinerary.length === 0) {
    emptyItinerary.style.display = 'block';
    itineraryGrid.innerHTML = '';
    return;
  }

  emptyItinerary.style.display = 'none';

  itineraryGrid.innerHTML = state.itinerary.map(item => {
    const dateDisplay = item.planned_date 
      ? `📅 ${new Date(item.planned_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` 
      : '📅 No date set';

    return `
      <article class="itinerary-card" data-id="${item.id}" tabindex="0" aria-label="View details for ${escapeHtml(item.name)}">
        <img src="${item.image_url || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=800&q=80'}" alt="${escapeHtml(item.name)}" class="itinerary-card-img">
        
        <div class="itinerary-card-body">
          <div class="itinerary-meta-row">
            <span class="category-pill" style="position: static;">${escapeHtml(item.category || 'Travel')}</span>
            <span class="itinerary-date-chip">${dateDisplay}</span>
          </div>

          <h3 class="dest-card-title">${escapeHtml(item.name)}</h3>
          <p class="dest-card-location">📍 ${escapeHtml(item.city || '')}${item.country ? ', ' + escapeHtml(item.country) : ''}</p>

          ${item.notes ? `<div class="itinerary-notes-box">📝 <strong>Note:</strong> ${escapeHtml(item.notes)}</div>` : ''}

          <div class="itinerary-card-footer">
            <span class="dest-card-rating">⭐ ${Number(item.rating || 5).toFixed(1)}</span>
            <button class="btn-danger btn-remove-itinerary" data-id="${item.id}">
              🗑️ Remove
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  itineraryGrid.querySelectorAll('.itinerary-card').forEach(card => {
    const openDetails = () => {
      const item = state.itinerary.find(destination => String(destination.id) === card.dataset.id);
      if (item) openItineraryDetails(item);
    };
    card.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      openDetails();
    });
    card.addEventListener('keydown', event => {
      if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      openDetails();
    });
  });

  itineraryGrid.querySelectorAll('.btn-remove-itinerary').forEach(btn => {
    btn.addEventListener('click', () => {
      removeFromItinerary(btn.dataset.id);
    });
  });
}

// --- Delete Destination from Itinerary ---
async function removeFromItinerary(id) {
  if (!state.user) return;

  const item = state.itinerary.find(i => i.id === id);
  const name = item ? item.name : 'Destination';

  try {
    const res = await fetch(`/api/itinerary/${id}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to remove destination');

    state.itinerary = state.itinerary.filter(i => i.id !== id);
    updateItineraryBadge();
    renderItinerary();
    renderDestinations();
    showToast(`Removed ${name} from itinerary`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Destination Details Modal ---
function setupModalEvents() {
  modalCloseBtn.addEventListener('click', closeModal);
  destinationModal.addEventListener('click', (e) => {
    if (e.target === destinationModal) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && destinationModal.style.display !== 'none') {
      closeModal();
    }
    if (e.key === 'Escape' && authModal.style.display !== 'none') {
      closeAuthModal();
    }
  });

  modalAddBtn.addEventListener('click', async () => {
    if (!state.activeModalDest) return;
    if (!state.user) {
      openAuthModal('login');
      showToast('Sign in to save destinations to your itinerary', 'info');
      return;
    }
    const dest = state.activeModalDest;
    const sourceRect = modalAddBtn.getBoundingClientRect();
    const dateVal = modalPlanDate.value;
    const notesVal = modalNotes.value.trim();

    try {
      const res = await fetch('/api/itinerary', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          destination_id: dest.id,
          name: dest.name,
          city: dest.city,
          country: dest.country,
          category: dest.category,
          description: dest.description,
          rating: dest.rating,
          image_url: dest.image_url,
          notes: notesVal,
          planned_date: dateVal
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add item');

      state.itinerary.unshift(data.data);
      updateItineraryBadge();
      renderDestinations();
      animateJetsIntoItinerary(sourceRect);
      closeModal();
      showToast(`Added ${dest.name} to itinerary!`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function openModal(destId) {
  const dest = state.destinations.find(d => d.id === destId);
  if (!dest) return;

  populateDestinationModal(dest, false);
}

function openItineraryDetails(item) {
  const destinationId = item.destination_id || item.id;
  const liveDestination = state.destinations.find(dest => dest.id === destinationId);
  const destination = liveDestination
    ? { ...item, ...liveDestination, id: destinationId, notes: item.notes, planned_date: item.planned_date }
    : { ...item, id: destinationId, weather: null };
  populateDestinationModal(destination, true);
}

function populateDestinationModal(dest, fromItinerary) {
  state.activeModalDest = dest;
  modalImg.src = dest.image_url || 'https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1200&q=80';
  modalImg.alt = dest.name || 'Destination photo';
  modalCategory.textContent = dest.category || 'Travel';
  modalTitle.textContent = dest.name;
  modalLocation.textContent = `📍 ${[dest.city, dest.country].filter(Boolean).join(', ')}`;
  modalRating.textContent = `⭐ ${Number(dest.rating || 5).toFixed(1)}`;
  modalDescription.textContent = dest.description || 'A saved destination on your travel itinerary.';
  modalFormSection.hidden = fromItinerary;
  modalItineraryMeta.hidden = !fromItinerary;
  modalItineraryMeta.replaceChildren();

  if (fromItinerary) {
    const plannedDate = dest.planned_date
      ? new Date(`${dest.planned_date}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
      : 'No date set';
    modalItineraryMeta.innerHTML = `
      <span class="modal-itinerary-label">SAVED TO YOUR ITINERARY</span>
      <p><strong>Planned date:</strong> ${escapeHtml(plannedDate)}</p>
      ${dest.notes ? `<p><strong>Trip notes:</strong> ${escapeHtml(dest.notes)}</p>` : ''}
    `;
  }

  const w = dest.weather;
  modalWeatherIcon.textContent = w ? w.icon : '⚠️';
  modalWeatherTemp.textContent = w ? `${w.temp}°C` : 'Unavailable';
  modalWeatherCond.textContent = w ? w.condition : 'Weather service unavailable';
  modalWeatherFeels.textContent = w ? `${w.apparent_temp ?? w.temp}°C` : '--°C';
  modalWeatherWind.textContent = w ? `${w.wind_speed} km/h` : '-- km/h';

  modalPlanDate.value = fromItinerary ? (dest.planned_date || '') : '';
  modalNotes.value = fromItinerary ? (dest.notes || '') : '';

  const isAdded = fromItinerary || state.itinerary.some(item => item.destination_id === dest.id || item.id === dest.id);
  if (isAdded) {
    modalAddBtn.disabled = true;
    modalAddBtn.innerHTML = '<span>✓ Already in Itinerary</span>';
    modalAddBtn.classList.add('btn-added');
  } else {
    modalAddBtn.disabled = false;
    modalAddBtn.innerHTML = '<span>+ Add to Itinerary</span>';
    modalAddBtn.classList.remove('btn-added');
  }

  destinationModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  destinationModal.style.display = 'none';
  document.body.style.overflow = '';
  state.activeModalDest = null;
}

function animateJetsIntoItinerary(sourceRect) {
  if (!sourceRect || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const targetRect = tabItinerary.getBoundingClientRect();
  const startX = sourceRect.left + sourceRect.width / 2;
  const startY = sourceRect.top + sourceRect.height / 2;
  const targetX = targetRect.left + targetRect.width / 2;
  const targetY = targetRect.top + targetRect.height / 2;
  const deltaX = targetX - startX;
  const deltaY = targetY - startY;

  [ -1, 1 ].forEach((side, index) => {
    const jet = document.createElement('img');
    jet.className = 'trip-flight-jet';
    jet.src = 'plane-cursor.svg';
    jet.alt = '';
    jet.setAttribute('aria-hidden', 'true');
    jet.style.left = `${startX + side * 9}px`;
    jet.style.top = `${startY}px`;
    document.body.appendChild(jet);

    const arcX = deltaX * 0.4 + side * 38;
    const arcY = deltaY * 0.42 - 48;
    const approachX = deltaX * 0.78 + side * 18;
    const approachY = deltaY * 0.8 - side * 8;
    const finalX = deltaX + side * 6;
    const finalY = deltaY - side * 3;
    const rotation = Math.atan2(deltaY, deltaX) * 180 / Math.PI + 50;

    const flight = jet.animate([
      { transform: 'translate(0, 0) rotate(0deg) scale(0.7)', opacity: 0 },
      { transform: `translate(${arcX * 0.3}px, ${arcY * 0.3}px) rotate(${rotation - 14}deg) scale(0.9)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${arcX}px, ${arcY}px) rotate(${rotation}deg) scale(1)`, opacity: 1, offset: 0.48 },
      { transform: `translate(${approachX}px, ${approachY}px) rotate(${rotation + side * 8}deg) scale(0.9)`, opacity: 0.95, offset: 0.78 },
      { transform: `translate(${finalX}px, ${finalY}px) rotate(${rotation + side * 12}deg) scale(0.55)`, opacity: 0 }
    ], {
      duration: 1000,
      delay: index * 130,
      easing: 'cubic-bezier(0.45, 0.05, 0.25, 1)',
      fill: 'forwards'
    });

    flight.finished.then(() => jet.remove()).catch(() => jet.remove());
  });
}

// --- Toast System ---
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️'}</span> <span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.25s ease';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

// --- Utilities ---
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Background Video Linked to Scroll ---
function setupScrollBackgroundVideo() {
  const video = document.getElementById('bg-video');
  if (!video) return;

  let targetTime = 0;
  let isTicking = false;

  const updateScrub = () => {
    if (video.duration && !isNaN(video.duration)) {
      const diff = targetTime - video.currentTime;
      if (Math.abs(diff) > 0.02) {
        video.currentTime += diff * 0.25;
        requestAnimationFrame(updateScrub);
        return;
      }
      video.currentTime = targetTime;
    }
    isTicking = false;
  };

  const onScroll = () => {
    const scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    const progress = Math.min(Math.max(scrollY / maxScroll, 0), 1);

    if (video.duration && !isNaN(video.duration)) {
      targetTime = progress * video.duration;
      if (!isTicking) {
        isTicking = true;
        requestAnimationFrame(updateScrub);
      }
    }
  };

  const primeVideo = () => {
    video.muted = true;
    video.play().then(() => {
      video.pause();
      onScroll();
    }).catch(() => {
      onScroll();
    });
  };

  if (video.readyState >= 1) {
    primeVideo();
  } else {
    video.addEventListener('loadedmetadata', primeVideo, { once: true });
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
}

function setupScrollDrivenWheels() {
  const wheels = [...document.querySelectorAll('[data-scroll-wheel]')];
  if (!wheels.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  let framePending = false;
  const updateRotation = () => {
    const rotation = (window.scrollY || document.documentElement.scrollTop || 0) * 0.12;
    wheels.forEach((wheel, index) => {
      wheel.style.setProperty('--scroll-rotation', `${index === 0 ? rotation : -rotation}deg`);
    });
    framePending = false;
  };

  const onScroll = () => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(updateRotation);
  };

  updateRotation();
  window.addEventListener('scroll', onScroll, { passive: true });
}
