// Global Variables
let supabaseClient;
let session = null;
let activePlayerId = null;
let leaderboardData = [];
let sessionGoals = 0;
let sessionMisses = 0;
let resetTimeoutId = null;
let ballRotationAngle = 0; // visual spin tracking

// Game State Variables
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ballStartPos = { x: 0, y: 32, z: 40 }; // 3D coordinates (x = left/right, y = height, z = distance)
const goalPlaneZ = 300; // Goal line distance (closer to camera to look bigger)
const goalWidth = 1400; // Goal width in 3D (-700 to +700)
const goalHeight = 550; // Goal height in 3D (0 to 550)

let ball = {
    x: ballStartPos.x,
    y: ballStartPos.y,
    z: ballStartPos.z,
    vx: 0,
    vy: 0,
    vz: 0,
    spinX: 0, // lateral Magnus spin
    radius: 45, // Larger ball
    kicked: false,
    state: 'idle', // 'idle', 'flying', 'goal', 'saved', 'miss', 'post'
    trail: []
};

let goalkeeper = {
    x: 0,
    y: 150,
    width: 240,
    height: 300,
    state: 'idle', // 'idle', 'dive_left', 'dive_right', 'jump', 'saved', 'missed'
    targetX: 0,
    targetY: 150,
    diveTimer: 0,
    diveDuration: 24, // faster dive response
    startX: 0,
    startY: 150
};

// Physics Constants
const gravity = 0.36; // Lower gravity for better loft
const drag = 0.994; // Smoother drag
const floorElasticity = 0.45;
const focalLength = 440; // Same focal length for natural projection

// Swipe Mechanics
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let dragEnd = { x: 0, y: 0 };
let dragStartTime = 0;

// Initialize Page
document.addEventListener('DOMContentLoaded', async () => {
    await initApp();
    setupAuthListeners();
    setupGameListeners();
});

// App Config & Initialization
async function initApp() {
    try {
        const response = await fetch('/api/config');
        const config = await response.json();
        
        // Supabase client uses domain/supabase as proxy url
        const supabaseUrl = window.location.origin + "/supabase";
        supabaseClient = supabase.createClient(supabaseUrl, config.supabaseAnonKey);
        
        // Get initial auth state
        const { data: { session: currentSession } } = await supabaseClient.auth.getSession();
        handleSessionChange(currentSession);
        
        // Listen for auth changes
        supabaseClient.auth.onAuthStateChange((_event, newSession) => {
            handleSessionChange(newSession);
        });
    } catch (err) {
        console.error("Initialization failed:", err);
        showAuthError("Server configuration loading failed.");
    }
}

// Auth State Handlers
async function handleSessionChange(newSession) {
    session = newSession;
    const authPanel = document.getElementById('auth-panel');
    const gamePanel = document.getElementById('game-panel');
    
    if (session) {
        authPanel.classList.remove('active');
        authPanel.classList.add('hidden');
        gamePanel.classList.remove('hidden');
        document.getElementById('user-email').innerHTML = `<i class="fa-regular fa-user"></i> ${session.user.email}`;
        
        // Fetch and map logged-in profile
        await loadUserProfile();
        
        // Load leaderboard list
        await loadPlayers();
        initCanvasGame();
    } else {
        gamePanel.classList.add('hidden');
        authPanel.classList.remove('hidden');
        authPanel.classList.add('active');
        stopGameLoop();
    }
}

async function loadUserProfile() {
    try {
        const token = session.access_token;
        const response = await fetch('/api/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
            const profile = await response.json();
            activePlayerId = profile.id;
            document.getElementById('hud-striker').textContent = profile.name;
        }
    } catch (err) {
        console.error("Error loading user profile:", err);
    }
}

// Setup Event Listeners for Login/Signup Form
function setupAuthListeners() {
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const authForm = document.getElementById('auth-form');
    const submitBtnText = document.querySelector('#auth-submit-btn .btn-text');
    let currentTab = 'login'; // 'login' or 'signup'
    
    tabLogin.addEventListener('click', () => {
        currentTab = 'login';
        tabLogin.classList.add('active');
        tabSignup.classList.remove('active');
        submitBtnText.textContent = 'Proceed to Field';
        hideAuthError();
        document.querySelector('.id-nickname-group').classList.add('hidden');
        document.getElementById('nickname').removeAttribute('required');
    });
    
    tabSignup.addEventListener('click', () => {
        currentTab = 'signup';
        tabSignup.classList.add('active');
        tabLogin.classList.remove('active');
        submitBtnText.textContent = 'Create Striker';
        hideAuthError();
        document.querySelector('.id-nickname-group').classList.remove('hidden');
        document.getElementById('nickname').setAttribute('required', 'true');
    });
    
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideAuthError();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        
        try {
            if (currentTab === 'login') {
                const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;
            } else {
                const nickname = document.getElementById('nickname').value;
                
                // 1. Supabase Auth Sign Up
                const { error } = await supabaseClient.auth.signUp({ email, password });
                if (error) throw error;
                
                // 2. Save credentials in local PostgreSQL via FastAPI
                const regResponse = await fetch('/api/register_profile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: nickname, email, password })
                });
                
                if (!regResponse.ok) {
                    const regErr = await regResponse.json();
                    throw new Error(regErr.detail || "Profile registration failed");
                }
                
                // 3. Log in automatically
                const { error: signInErr } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (signInErr) throw signInErr;
            }
        } catch (err) {
            showAuthError(err.message || "Authentication failed.");
        }
    });
    
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
    });
}

function showAuthError(msg) {
    const errorPanel = document.getElementById('auth-error');
    document.getElementById('error-text').textContent = msg;
    errorPanel.classList.remove('hidden');
}

function hideAuthError() {
    document.getElementById('auth-error').classList.add('hidden');
}

// Game Page Controls & API Handlers
function setupGameListeners() {
    document.getElementById('btn-start-game').addEventListener('click', () => {
        document.getElementById('canvas-overlay').classList.remove('active');
    });

    document.getElementById('btn-next-kick').addEventListener('click', () => {
        if (resetTimeoutId) clearTimeout(resetTimeoutId);
        resetBall();
        document.getElementById('btn-next-kick').classList.add('hidden');
    });
}

async function loadPlayers() {
    try {
        const response = await fetch('/api/leaderboard');
        leaderboardData = await response.json();
        
        // Update local HUD striker display if already loaded
        if (activePlayerId) {
            const active = leaderboardData.find(p => p.id === activePlayerId);
            if (active) {
                document.getElementById('hud-striker').textContent = active.name;
            }
        }
        
        renderLeaderboard();
    } catch (err) {
        console.error("Error loading players:", err);
    }
}

function updatePlayerProfile(player) {
    document.getElementById('player-profile').classList.remove('hidden');
    document.getElementById('profile-name').textContent = player.name;
    document.getElementById('profile-goals').textContent = player.goals;
    document.getElementById('profile-misses').textContent = player.misses;
}

function renderLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    tbody.innerHTML = '';
    
    const searchQuery = (document.getElementById('leaderboard-search')?.value || '').toLowerCase();
    const filtered = leaderboardData.filter(p => {
        return p.name.toLowerCase().includes(searchQuery) || 
               (p.email && p.email.toLowerCase().includes(searchQuery));
    });
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 20px;">No players found</td></tr>`;
        return;
    }
    
    filtered.forEach((p) => {
        const total = p.goals + p.misses;
        const rate = total > 0 ? Math.round((p.goals / total) * 100) : 0;
        const actualRank = leaderboardData.findIndex(item => item.id === p.id) + 1;
        
        const tr = document.createElement('tr');
        if (p.id === activePlayerId) {
            tr.classList.add('active-player-row');
        }
        
        tr.innerHTML = `
            <td title="${p.name}"><strong>${actualRank}.</strong> ${p.name}</td>
            <td title="${p.email}">${p.email || '-'}</td>
            <td><i class="fa-solid fa-circle-check text-green"></i> ${p.goals}</td>
            <td><i class="fa-solid fa-circle-xmark text-red"></i> ${p.misses}</td>
            <td><strong>${rate}%</strong></td>
        `;
        tbody.appendChild(tr);
    });
}

// Bind search input
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('leaderboard-search');
    if (searchInput) {
        searchInput.addEventListener('input', renderLeaderboard);
    }
});

// ----------------------------------------------------
// CANVAS GRAPHICS & PHYSICS ENGINE
// ----------------------------------------------------
let animationFrameId = null;

function initCanvasGame() {
    stopGameLoop();
    resetBall();
    
    // Add Click and Hover Listeners
    canvas.addEventListener('click', handleShootClick);
    canvas.addEventListener('mousemove', handleShootMove);
    canvas.addEventListener('touchmove', handleShootMove, { passive: true });
    canvas.addEventListener('touchstart', handleTouchShoot, { passive: true });
    
    startGameLoop();
}

function stopGameLoop() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    canvas.removeEventListener('click', handleShootClick);
    canvas.removeEventListener('mousemove', handleShootMove);
    canvas.removeEventListener('touchmove', handleShootMove);
    canvas.removeEventListener('touchstart', handleTouchShoot);
}

function startGameLoop() {
    function loop() {
        updatePhysics();
        drawScene();
        animationFrameId = requestAnimationFrame(loop);
    }
    loop();
}

function resetBall() {
    ball.x = ballStartPos.x;
    ball.y = ballStartPos.y;
    ball.z = ballStartPos.z;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.spinX = 0;
    ball.kicked = false;
    ball.state = 'idle';
    ball.trail = [];
    ballRotationAngle = 0;
    
    goalkeeper.x = 0;
    goalkeeper.y = 150;
    goalkeeper.state = 'idle';
    goalkeeper.diveTimer = 0;
    
    const nextKickBtn = document.getElementById('btn-next-kick');
    if (nextKickBtn) nextKickBtn.classList.add('hidden');
}

// Projection function 3D -> 2D
function project3D(x, y, z) {
    const scale = focalLength / (focalLength + z);
    const screenX = canvas.width / 2 + x * scale;
    // Ground is projected around height - 140 (scaled twofold)
    const groundLevelY = canvas.height - 140;
    const screenY = groundLevelY - (y * scale);
    const radius = ball.radius * scale;
    
    return { x: screenX, y: screenY, radius: radius, visible: scale > 0 };
}

// Hover / Click Aiming mechanics
let aimScreenPos = { x: canvas.width / 2, y: canvas.height / 2 - 50 };

function getCanvasMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = (e.touches && e.touches.length > 0) ? e.touches[0].clientX : e.clientX;
    const clientY = (e.touches && e.touches.length > 0) ? e.touches[0].clientY : e.clientY;
    
    return {
        x: ((clientX - rect.left) / rect.width) * canvas.width,
        y: ((clientY - rect.top) / rect.height) * canvas.height
    };
}

function handleShootMove(e) {
    aimScreenPos = getCanvasMousePos(e);
}

function handleTouchShoot(e) {
    if (ball.kicked) return;
    const mousePos = getCanvasMousePos(e);
    aimScreenPos = mousePos;
    executeShoot(mousePos);
}

function handleShootClick(e) {
    if (ball.kicked) return;
    const mousePos = getCanvasMousePos(e);
    executeShoot(mousePos);
}

function executeShoot(mousePos) {
    if (!activePlayerId) {
        alert("Please log in first to shoot penalties!");
        return;
    }
    
    // 1. Unproject mouse coordinates to 3D space at the goal plane
    const target3D = unproject3D(mousePos.x, mousePos.y, goalPlaneZ);
    
    // 2. Add some minor organic variance (simulating kick accuracy)
    const accuracyNoiseX = (Math.random() - 0.5) * 16;
    const accuracyNoiseY = (Math.random() - 0.5) * 16;
    
    const finalTargetX = target3D.x + accuracyNoiseX;
    const finalTargetY = Math.max(32, target3D.y + accuracyNoiseY); // ground level is 32
    
    // 3. Compute dynamic frames N based on distance to feel realistic
    const dx = finalTargetX - ballStartPos.x;
    const dy = finalTargetY - ballStartPos.y;
    const dz = goalPlaneZ - ballStartPos.z;
    const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
    
    // Constrain N between 24 and 34 frames (smoother, slower speed)
    const N = Math.max(24, Math.min(34, Math.round(distance / 24)));
    goalkeeper.diveDuration = N; // sync goalie dive time with ball flight
    
    // Sum of drag factors: sum = (1 - drag^N) / (1 - drag)
    const dragSum = (1 - Math.pow(drag, N)) / (1 - drag);
    
    // Set side-spin (Magnus coefficient) based on target horizontal displacement
    ball.spinX = (finalTargetX / goalWidth) * 3.5;
    
    // Compute starting velocities, compensating vx for the curve effect
    ball.vx = (dx / dragSum) - (ball.spinX * 3.5);
    const gravityComp = (gravity * N) / 1.7; // empirical adjustment for drag
    ball.vy = (dy / dragSum) + gravityComp;
    ball.vz = dz / dragSum;
    
    ball.kicked = true;
    ball.state = 'flying';
    
    // Start Goalkeeper reaction based on randomized sector selection (previous AI)
    initiateGoalkeeperDefense();
}

function unproject3D(screenX, screenY, z) {
    const scale = focalLength / (focalLength + z);
    const groundLevelY = canvas.height - 140;
    const x = (screenX - canvas.width / 2) / scale;
    const y = (groundLevelY - screenY) / scale;
    return { x, y };
}

// Goalkeeper logic (Reverted to sector choices)
function initiateGoalkeeperDefense() {
    const choices = ['left', 'right', 'high_left', 'high_right', 'center'];
    const rIdx = Math.floor(Math.random() * choices.length);
    const decision = choices[rIdx];
    
    goalkeeper.startX = goalkeeper.x;
    goalkeeper.startY = goalkeeper.y;
    
    if (decision === 'left') {
        goalkeeper.targetX = -450;
        goalkeeper.targetY = 70;
        goalkeeper.state = 'dive_left';
    } else if (decision === 'right') {
        goalkeeper.targetX = 450;
        goalkeeper.targetY = 70;
        goalkeeper.state = 'dive_right';
    } else if (decision === 'high_left') {
        goalkeeper.targetX = -400;
        goalkeeper.targetY = 400;
        goalkeeper.state = 'dive_left';
    } else if (decision === 'high_right') {
        goalkeeper.targetX = 400;
        goalkeeper.targetY = 400;
        goalkeeper.state = 'dive_right';
    } else {
        goalkeeper.targetX = 0;
        goalkeeper.targetY = 150;
        goalkeeper.state = 'idle';
    }
    
    goalkeeper.diveTimer = 0;
}

// Physics Loop
function updatePhysics() {
    if (!ball.kicked) return;
    
    // Add path trail
    if (ball.state === 'flying') {
        ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
        if (ball.trail.length > 10) ball.trail.shift();
    }
    
    // Goalkeeper diving and falling physics
    if (goalkeeper.state !== 'idle') {
        goalkeeper.diveTimer++;
        if (goalkeeper.diveTimer <= goalkeeper.diveDuration) {
            const t = goalkeeper.diveTimer / goalkeeper.diveDuration;
            // Easing function for smooth dive
            const easeOut = 1 - Math.pow(1 - t, 3);
            goalkeeper.x = goalkeeper.startX + (goalkeeper.targetX - goalkeeper.startX) * easeOut;
            goalkeeper.y = goalkeeper.startY + (goalkeeper.targetY - goalkeeper.startY) * easeOut;
        } else {
            // Goalkeeper falls down after dive completes
            const groundLieY = 100; // lying down center height
            if (goalkeeper.y > groundLieY) {
                goalkeeper.y -= 7; // fall speed
                if (goalkeeper.y < groundLieY) goalkeeper.y = groundLieY;
            }
            // Add a slide/momentum movement
            if (goalkeeper.state === 'dive_left' || goalkeeper.state === 'dive_right') {
                goalkeeper.x += (goalkeeper.state === 'dive_left' ? -2.5 : 2.5);
            }
        }
    }
    
    if (ball.state === 'flying') {
        // Apply velocity
        ball.x += ball.vx;
        ball.y += ball.vy;
        ball.z += ball.vz;
        
        // Apply Magnus horizontal curve physics
        if (ball.spinX) {
            ball.vx += ball.spinX * 0.32 * (ball.vz / goalPlaneZ);
        }
        
        // Gravity
        ball.vy -= gravity;
        
        // Air resistance
        ball.vx *= drag;
        ball.vy *= drag;
        ball.vz *= drag;
        
        // Ground contact (before goal line)
        if (ball.y <= 32 && ball.z < goalPlaneZ) {
            ball.y = 32;
            ball.vy = -ball.vy * floorElasticity;
            ball.vx *= 0.8;
            ball.vz *= 0.8;
        }
        
        // Check outcome when ball reaches goal plane
        if (ball.z >= goalPlaneZ) {
            resolveShot();
        }
    } else if (ball.state === 'goal') {
        // Soft net physics: ball enters, hits net, slows down and falls inside goal
        ball.x += ball.vx * 0.45;
        ball.y += ball.vy * 0.45;
        ball.z += ball.vz * 0.45;
        
        ball.vy -= gravity;
        
        // Back of net collision (hanging back by netDepth = 120)
        const netBackZ = goalPlaneZ + 100;
        if (ball.z >= netBackZ) {
            ball.z = netBackZ;
            ball.vz = -ball.vz * 0.05; // absorb speed (very soft)
            ball.vx *= 0.4;
            ball.vy *= 0.4;
        }
        // Side net collision
        const halfW = goalWidth / 2 - 15; // 685
        if (Math.abs(ball.x) >= halfW) {
            ball.x = Math.sign(ball.x) * halfW;
            ball.vx = -ball.vx * 0.1; // absorb side speed
        }
        // Top crossbar net collision
        if (ball.y >= goalHeight - 15) {
            ball.y = goalHeight - 15;
            ball.vy = -ball.vy * 0.1;
        }
        // Ground bounce inside net
        if (ball.y <= 32) {
            ball.y = 32;
            ball.vy = -ball.vy * 0.15; // soft bounce on grass
            ball.vx *= 0.4;
            ball.vz *= 0.4;
        }
    } else if (ball.state === 'saved' || ball.state === 'miss' || ball.state === 'post') {
        // Standard rigid bounce physics
        ball.x += ball.vx * 0.5;
        ball.y += ball.vy * 0.5;
        ball.z += ball.vz * 0.5;
        
        ball.vy -= gravity;
        
        if (ball.y <= 32) {
            ball.y = 32;
            ball.vy = -ball.vy * floorElasticity;
            ball.vx *= 0.6;
            ball.vz *= 0.6;
        }
    }
}

// Shot outcome resolver
function resolveShot() {
    ball.z = goalPlaneZ;
    
    const bx = ball.x;
    const by = ball.y;
    
    // Goal bounds in 3D: width [-700, 700], height [32, 550]
    const margin = 32;
    
    // Check if hit crossbar or post
    const hitPost = (Math.abs(Math.abs(bx) - 700) < margin && by >= 32 && by <= 550) || 
                    (Math.abs(by - 550) < margin && bx >= -700 && bx <= 700);
                    
    const insideGoal = (bx >= -700 && bx <= 700 && by >= 32 && by <= 550);
    
    if (hitPost) {
        ball.state = 'post';
        ball.vx = -ball.vx * 0.5 + (Math.random() - 0.5) * 8;
        ball.vy = -ball.vy * 0.3 + 6;
        ball.vz = -ball.vz * 0.4;
        registerResult('miss');
    } else if (insideGoal) {
        const gkDist = Math.sqrt(Math.pow(bx - goalkeeper.x, 2) + Math.pow(by - goalkeeper.y, 2));
        
        // Goalkeeper reach radius (220 pixels in 3D space)
        if (gkDist < 220) {
            ball.state = 'saved';
            goalkeeper.state = 'saved';
            ball.vx = (bx - goalkeeper.x) * 0.25;
            ball.vy = (by - goalkeeper.y) * 0.25 + 4;
            ball.vz = -ball.vz * 0.3;
            registerResult('miss');
        } else {
            ball.state = 'goal';
            ball.vx *= 0.15;
            ball.vy *= 0.15;
            ball.vz *= 0.05;
            registerResult('goal');
        }
    } else {
        ball.state = 'miss';
        registerResult('miss');
    }
}

async function registerResult(outcome) {
    if (outcome === 'goal') {
        sessionGoals++;
        document.getElementById('session-goals').textContent = sessionGoals;
        showToast("GOAL! What a strike!", "success");
    } else {
        sessionMisses++;
        document.getElementById('session-misses').textContent = sessionMisses;
        showToast("MISSED! Nice try...", "error");
    }
    
    // Call API
    try {
        const token = session.access_token;
        const response = await fetch('/api/kick', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                player_id: activePlayerId,
                result: outcome
            })
        });
        
        if (response.ok) {
            // Reload leaderboard
            loadPlayers();
        } else {
            console.error("Failed to update database stats");
        }
    } catch (err) {
        console.error("API Call error:", err);
    }
    
    // Trigger auto-reset after 4.5 seconds
    if (resetTimeoutId) clearTimeout(resetTimeoutId);
    document.getElementById('btn-next-kick').classList.remove('hidden');
    resetTimeoutId = setTimeout(() => {
        resetBall();
        document.getElementById('btn-next-kick').classList.add('hidden');
    }, 4500);
}

// Toast Notification
function showToast(msg, type) {
    const hud = document.querySelector('.game-hud');
    const toast = document.createElement('div');
    toast.className = `game-toast ${type}`;
    toast.innerHTML = `<i class="${type === 'success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'}"></i> ${msg}`;
    
    // Apply styling via JS temporarily
    Object.assign(toast.style, {
        position: 'absolute',
        top: '15px',
        left: '50%',
        transform: 'translateX(-50%) translateY(-20px)',
        padding: '10px 24px',
        borderRadius: '8px',
        background: type === 'success' ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)',
        color: 'white',
        fontWeight: 'bold',
        fontSize: '1rem',
        boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
        opacity: '0',
        transition: 'all 0.3s ease',
        zIndex: '100',
        pointerEvents: 'none'
    });
    
    document.querySelector('.canvas-wrapper').appendChild(toast);
    
    // Animate in
    setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    }, 10);
    
    // Fade out and remove
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// ----------------------------------------------------
// CANVAS RENDERING ENGINE (BEAUTIFUL VECTOR SHAPES)
// ----------------------------------------------------
function getNetDisplacement(x, y, z) {
    if (ball.state === 'goal') {
        const dx = ball.x - x;
        const dy = ball.y - y;
        const dz = ball.z - z;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        const influenceRadius = 180; // area of net affected
        
        if (dist < influenceRadius) {
            const force = 1 - dist / influenceRadius;
            // Push net out based on ball trajectory and displacement
            return {
                dx: (ball.x - x) * force * 0.45 + ball.vx * force * 0.7,
                dy: (ball.y - y) * force * 0.45 + ball.vy * force * 0.7,
                dz: (ball.z - z) * force * 0.45 + ball.vz * force * 0.8
            };
        }
    }
    return { dx: 0, dy: 0, dz: 0 };
}

function drawScene() {
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1. Draw Field Turf Background
    const skyGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGradient.addColorStop(0, '#060c13');
    skyGradient.addColorStop(0.7, '#0f1f1d');
    skyGradient.addColorStop(1, '#0e2316');
    ctx.fillStyle = skyGradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw Field Grass Green Polygon
    const groundLevelY = canvas.height - 140;
    
    ctx.fillStyle = '#0f2b18';
    ctx.beginPath();
    ctx.moveTo(0, groundLevelY);
    ctx.lineTo(canvas.width, groundLevelY);
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fill();
    
    // Grass stripes (3D perspective)
    const stripeCount = 6;
    ctx.fillStyle = '#0c2414';
    for (let i = 0; i < stripeCount; i += 2) {
        const zNear = 20 + (i / stripeCount) * 280;
        const zFar = 20 + ((i + 1) / stripeCount) * 280;
        
        const pLeftNear = project3D(-600, 0, zNear);
        const pRightNear = project3D(600, 0, zNear);
        const pLeftFar = project3D(-600, 0, zFar);
        const pRightFar = project3D(600, 0, zFar);
        
        ctx.beginPath();
        ctx.moveTo(pLeftNear.x, pLeftNear.y);
        ctx.lineTo(pRightNear.x, pRightNear.y);
        ctx.lineTo(pRightFar.x, pRightFar.y);
        ctx.lineTo(pLeftFar.x, pLeftFar.y);
        ctx.closePath();
        ctx.fill();
    }
    
    // Penalty area lines in perspective
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 2;
    
    // Goal line
    const gl1 = project3D(-700, 0, goalPlaneZ);
    const gl2 = project3D(700, 0, goalPlaneZ);
    ctx.beginPath();
    ctx.moveTo(gl1.x, gl1.y);
    ctx.lineTo(gl2.x, gl2.y);
    ctx.stroke();
    
    // Six yard box outline
    const boxNearL = project3D(-240, 0, 160);
    const boxNearR = project3D(240, 0, 160);
    const boxFarL = project3D(-240, 0, goalPlaneZ);
    const boxFarR = project3D(240, 0, goalPlaneZ);
    
    ctx.beginPath();
    ctx.moveTo(boxFarL.x, boxFarL.y);
    ctx.lineTo(boxNearL.x, boxNearL.y);
    ctx.lineTo(boxNearR.x, boxNearR.y);
    ctx.lineTo(boxFarR.x, boxFarR.y);
    ctx.stroke();
    
    // 2. Draw Goal Net & Posts
    const halfGoalW = goalWidth / 2; // 700
    const postLeftTop = project3D(-halfGoalW, goalHeight, goalPlaneZ);
    const postLeftBottom = project3D(-halfGoalW, 32, goalPlaneZ);
    const postRightTop = project3D(halfGoalW, goalHeight, goalPlaneZ);
    const postRightBottom = project3D(halfGoalW, 32, goalPlaneZ);
    
    // Back of net coordinates (hanging back slightly)
    const netDepth = 120;
    
    // Draw net lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    // Horizontal net segments
    const netSegments = 10;
    for (let h = 0; h <= netSegments; h++) {
        const heightVal = 32 + (h / netSegments) * (goalHeight - 32);
        const leftP = project3D(-halfGoalW, heightVal, goalPlaneZ);
        const rightP = project3D(halfGoalW, heightVal, goalPlaneZ);
        
        const blDisp = getNetDisplacement(-halfGoalW, heightVal, goalPlaneZ + netDepth);
        const backLeftP = project3D(-halfGoalW + blDisp.dx, heightVal + blDisp.dy, goalPlaneZ + netDepth + blDisp.dz);
        
        const brDisp = getNetDisplacement(halfGoalW, heightVal, goalPlaneZ + netDepth);
        const backRightP = project3D(halfGoalW + brDisp.dx, heightVal + brDisp.dy, goalPlaneZ + netDepth + brDisp.dz);
        
        ctx.beginPath();
        ctx.moveTo(leftP.x, leftP.y);
        ctx.lineTo(backLeftP.x, backLeftP.y);
        ctx.lineTo(backRightP.x, backRightP.y);
        ctx.lineTo(rightP.x, rightP.y);
        ctx.stroke();
    }
    // Vertical net lines
    const vNetSegments = 20;
    for (let w = 0; w <= vNetSegments; w++) {
        const xVal = -halfGoalW + (w / vNetSegments) * goalWidth;
        const frontTop = project3D(xVal, goalHeight, goalPlaneZ);
        const frontBot = project3D(xVal, 32, goalPlaneZ);
        
        const btDisp = getNetDisplacement(xVal, goalHeight, goalPlaneZ + netDepth);
        const backTop = project3D(xVal + btDisp.dx, goalHeight + btDisp.dy, goalPlaneZ + netDepth + btDisp.dz);
        
        const bbDisp = getNetDisplacement(xVal, 32, goalPlaneZ + netDepth);
        const backBot = project3D(xVal + bbDisp.dx, 32 + bbDisp.dy, goalPlaneZ + netDepth + bbDisp.dz);
        
        ctx.beginPath();
        ctx.moveTo(frontBot.x, frontBot.y);
        ctx.lineTo(frontTop.x, frontTop.y);
        ctx.lineTo(backTop.x, backTop.y);
        ctx.lineTo(backBot.x, backBot.y);
        ctx.stroke();
    }
    
    // Draw physical goal posts (white glow bars)
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
    
    ctx.beginPath();
    ctx.moveTo(postLeftBottom.x, postLeftBottom.y);
    ctx.lineTo(postLeftTop.x, postLeftTop.y);
    ctx.lineTo(postRightTop.x, postRightTop.y);
    ctx.lineTo(postRightBottom.x, postRightBottom.y);
    ctx.stroke();
    
    // Reset shadow parameters
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1;
    
    // 3. Draw Goalkeeper
    drawGoalkeeper();
    
    // 4. Draw Hover Aim Crosshair & Laser Indicator Line
    if (!ball.kicked && activePlayerId) {
        // Draw laser path line
        ctx.save();
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.22)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        const pBall = project3D(ball.x, ball.y, ball.z);
        ctx.moveTo(pBall.x, pBall.y);
        ctx.lineTo(aimScreenPos.x, aimScreenPos.y);
        ctx.stroke();
        ctx.restore();
        
        // Draw crosshair reticle
        ctx.save();
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
        ctx.lineWidth = 2.5;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
        
        ctx.beginPath();
        ctx.arc(aimScreenPos.x, aimScreenPos.y, 16, 0, Math.PI * 2);
        ctx.moveTo(aimScreenPos.x - 26, aimScreenPos.y);
        ctx.lineTo(aimScreenPos.x + 26, aimScreenPos.y);
        ctx.moveTo(aimScreenPos.x, aimScreenPos.y - 26);
        ctx.lineTo(aimScreenPos.x, aimScreenPos.y + 26);
        ctx.stroke();
        ctx.restore();
    }
    
    // 5. Draw Ball Trail (for action look)
    if (ball.state === 'flying' && ball.trail.length > 1) {
        ctx.beginPath();
        const pStart = project3D(ball.trail[0].x, ball.trail[0].y, ball.trail[0].z);
        ctx.moveTo(pStart.x, pStart.y);
        for (let i = 1; i < ball.trail.length; i++) {
            const p = project3D(ball.trail[i].x, ball.trail[i].y, ball.trail[i].z);
            ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
    
    // 6. Draw Ball (scaled with spin rotation and squash/stretch physics)
    const pBall = project3D(ball.x, ball.y, ball.z);
    if (pBall.visible) {
        // Draw shadow on ground (grass Y = 32)
        const pShadow = project3D(ball.x, 32, ball.z);
        const shadowOpacity = Math.max(0, 0.45 - (ball.y / 250));
        ctx.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`;
        ctx.beginPath();
        ctx.ellipse(pShadow.x, pShadow.y, pBall.radius, pBall.radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.save();
        ctx.translate(pBall.x, pBall.y);
        
        // Squash and stretch deformation calculation
        let squashX = 1;
        let squashY = 1;
        if (ball.state === 'flying' || ball.state === 'goal') {
            const speed = Math.sqrt(ball.vx*ball.vx + ball.vy*ball.vy + ball.vz*ball.vz);
            if (speed > 5) {
                const stretch = Math.min(0.12, speed * 0.0035);
                squashY = 1 + stretch;
                squashX = 1 - stretch;
                const angle = Math.atan2(ball.vy, ball.vx);
                ctx.rotate(angle);
            }
        } else if (ball.y <= 33 && Math.abs(ball.vy) > 0.5) {
            squashY = 0.78;
            squashX = 1.22;
        }
        ctx.scale(squashX, squashY);
        
        // Real-time spin rotation
        ballRotationAngle += (ball.vx * 0.03 + ball.vz * 0.08);
        ctx.rotate(ballRotationAngle);
        
        // Draw white ball base
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(0, 0, pBall.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Draw black pentagons and seams
        ctx.strokeStyle = '#090e14';
        ctx.lineWidth = pBall.radius * 0.08;
        ctx.fillStyle = '#090e14';
        
        const r = pBall.radius;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.2);
        ctx.lineTo(-r * 0.2, r * 0.05);
        ctx.lineTo(-r * 0.12, r * 0.3);
        ctx.lineTo(r * 0.12, r * 0.3);
        ctx.lineTo(r * 0.2, r * 0.05);
        ctx.closePath();
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.2); ctx.lineTo(0, -r);
        ctx.moveTo(-r * 0.2, r * 0.05); ctx.lineTo(-r * 0.9, r * 0.2);
        ctx.moveTo(r * 0.2, r * 0.05); ctx.lineTo(r * 0.9, r * 0.2);
        ctx.moveTo(-r * 0.12, r * 0.3); ctx.lineTo(-r * 0.5, r * 0.85);
        ctx.moveTo(r * 0.12, r * 0.3); ctx.lineTo(r * 0.5, r * 0.85);
        ctx.stroke();
        
        ctx.restore();
    }
}

// stylized goalkeeper rendering
function drawGoalkeeper() {
    const pGk = project3D(goalkeeper.x, goalkeeper.y, goalPlaneZ);
    const scale = focalLength / (focalLength + goalPlaneZ);
    const gkWidth = goalkeeper.width * scale;
    const gkHeight = goalkeeper.height * scale;
    
    ctx.save();
    
    // Apply goalie shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(pGk.x, canvas.height - 140, gkWidth * 0.8, gkWidth * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.translate(pGk.x, pGk.y);
    
    // Choose colors (e.g. Neon orange jersey, black shorts)
    const jerseyColor = '#f97316';
    const skinColor = '#ffedd5';
    const pantsColor = '#1e293b';
    
    // Rotation based on dive state (lie completely flat when falling)
    let rotation = 0;
    if (goalkeeper.state === 'dive_left') {
        const isFalling = goalkeeper.diveTimer > goalkeeper.diveDuration;
        rotation = isFalling ? Math.PI / 2 : Math.PI / 4.5;
    } else if (goalkeeper.state === 'dive_right') {
        const isFalling = goalkeeper.diveTimer > goalkeeper.diveDuration;
        rotation = isFalling ? -Math.PI / 2 : -Math.PI / 4.5;
    } else if (goalkeeper.state === 'saved') {
        rotation = (goalkeeper.x < 0) ? Math.PI / 2.2 : -Math.PI / 2.2;
    }
    ctx.rotate(rotation);
    
    // Drawing body silhouette
    // 1. Head
    ctx.fillStyle = skinColor;
    ctx.beginPath();
    ctx.arc(0, -gkHeight * 0.4, gkHeight * 0.12, 0, Math.PI * 2);
    ctx.fill();
    
    // 2. Torso (jersey)
    ctx.fillStyle = jerseyColor;
    ctx.beginPath();
    ctx.moveTo(-gkWidth * 0.3, -gkHeight * 0.25);
    ctx.lineTo(gkWidth * 0.3, -gkHeight * 0.25);
    ctx.lineTo(gkWidth * 0.25, gkHeight * 0.1);
    ctx.lineTo(-gkWidth * 0.25, gkHeight * 0.1);
    ctx.closePath();
    ctx.fill();
    
    // 3. Sleeves & Arms (Active position depending on dive)
    ctx.fillStyle = jerseyColor;
    ctx.strokeStyle = skinColor;
    ctx.lineWidth = gkHeight * 0.08;
    ctx.lineCap = 'round';
    
    if (goalkeeper.state === 'idle') {
        // Arms out wide ready to save
        ctx.beginPath(); // Left Arm
        ctx.moveTo(-gkWidth * 0.25, -gkHeight * 0.2);
        ctx.lineTo(-gkWidth * 0.65, -gkHeight * 0.15);
        ctx.stroke();
        
        ctx.beginPath(); // Right Arm
        ctx.moveTo(gkWidth * 0.25, -gkHeight * 0.2);
        ctx.lineTo(gkWidth * 0.65, -gkHeight * 0.15);
        ctx.stroke();
    } else {
        // Diving: arms reaching up/forward
        ctx.beginPath(); // Left Arm reaching
        ctx.moveTo(-gkWidth * 0.25, -gkHeight * 0.2);
        ctx.lineTo(-gkWidth * 0.5, -gkHeight * 0.5);
        ctx.stroke();
        
        ctx.beginPath(); // Right Arm reaching
        ctx.moveTo(gkWidth * 0.25, -gkHeight * 0.2);
        ctx.lineTo(gkWidth * 0.5, -gkHeight * 0.5);
        ctx.stroke();
    }
    
    // 4. Shorts (pants)
    ctx.fillStyle = pantsColor;
    ctx.fillRect(-gkWidth * 0.25, gkHeight * 0.1, gkWidth * 0.5, gkHeight * 0.15);
    
    // 5. Legs
    ctx.strokeStyle = skinColor;
    ctx.lineWidth = gkHeight * 0.09;
    
    // Left Leg
    ctx.beginPath();
    ctx.moveTo(-gkWidth * 0.15, gkHeight * 0.25);
    ctx.lineTo(-gkWidth * 0.18, gkHeight * 0.45);
    ctx.stroke();
    
    // Right Leg
    ctx.beginPath();
    ctx.moveTo(gkWidth * 0.15, gkHeight * 0.25);
    ctx.lineTo(gkWidth * 0.18, gkHeight * 0.45);
    ctx.stroke();
    
    ctx.restore();
}
