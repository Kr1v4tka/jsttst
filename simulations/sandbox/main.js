/**
 * Основная логика симуляции песочницы Pro
 * Полнофункциональная версия с расширенными возможностями
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Устанавливаем размер канваса на весь контейнер
    function resizeCanvas() {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        physics.width = canvas.width;
        physics.height = canvas.height;
    }
    
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Инициализация физического движка
    const physics = new PhysicsEngine(canvas.width, canvas.height, 9.8, 0.7);
    
    // Состояние приложения
    const appState = {
        currentTool: 'select', // select, spawn, destroy, freeze, joint
        isPaused: false,
        showStats: true,
        showGrid: true,
        particlesEnabled: true,
        sleepEnabled: true,
        timeScale: 1,
        collisionCount: 0,
        jointMode: false,
        selectedForJoint: null
    };
    
    // Элементы управления
    const addBallBtn = document.getElementById('addBall');
    const addBoxBtn = document.getElementById('addBox');
    const addTriangleBtn = document.getElementById('addTriangle');
    const addStackBtn = document.getElementById('addStack');
    const addRainBtn = document.getElementById('addRain');
    const clearBtn = document.getElementById('clear');
    
    const gravitySlider = document.getElementById('gravity');
    const gravityValue = document.getElementById('gravityValue');
    const bounceSlider = document.getElementById('bounce');
    const bounceValue = document.getElementById('bounceValue');
    const frictionSlider = document.getElementById('friction');
    const frictionValue = document.getElementById('frictionValue');
    const timeScaleSlider = document.getElementById('timeScale');
    const timeScaleValue = document.getElementById('timeScaleValue');
    
    const showStatsCheckbox = document.getElementById('showStats');
    const showGridCheckbox = document.getElementById('showGrid');
    const particlesCheckbox = document.getElementById('particles');
    const sleepEnabledCheckbox = document.getElementById('sleepEnabled');
    
    const toolSelect = document.getElementById('toolSelect');
    const toolSpawn = document.getElementById('toolSpawn');
    const toolDestroy = document.getElementById('toolDestroy');
    const toolFreeze = document.getElementById('toolFreeze');
    const toolJoint = document.getElementById('toolJoint');
    const pauseBtn = document.getElementById('pauseBtn');
    
    // Статистика
    const statObjects = document.getElementById('statObjects');
    const statParticles = document.getElementById('statParticles');
    const statFps = document.getElementById('statFps');
    const statCollisions = document.getElementById('statCollisions');
    const statJoints = document.getElementById('statJoints');
    const infoObjects = document.getElementById('infoObjects');
    const infoParticles = document.getElementById('infoParticles');
    const infoFps = document.getElementById('infoFps');
    const infoJoints = document.getElementById('infoJoints');
    
    // Обновление значений слайдеров
    gravitySlider.addEventListener('input', () => {
        const value = parseFloat(gravitySlider.value);
        physics.gravity = new Vector2(0, value);
        gravityValue.textContent = value.toFixed(1);
    });
    
    bounceSlider.addEventListener('input', () => {
        const value = parseFloat(bounceSlider.value);
        physics.bounce = value;
        bounceValue.textContent = value.toFixed(2);
        physics.objects.forEach(obj => { obj.restitution = value; });
    });
    
    frictionSlider.addEventListener('input', () => {
        const value = parseFloat(frictionSlider.value);
        physics.damping = value;
        frictionValue.textContent = value.toFixed(2);
    });
    
    timeScaleSlider.addEventListener('input', () => {
        const value = parseFloat(timeScaleSlider.value);
        appState.timeScale = value;
        timeScaleValue.textContent = value.toFixed(1) + 'x';
    });
    
    // Чекбоксы
    showStatsCheckbox.addEventListener('change', (e) => {
        appState.showStats = e.target.checked;
        document.getElementById('overlayInfo').style.display = e.target.checked ? 'block' : 'none';
    });
    
    showGridCheckbox.addEventListener('change', (e) => {
        appState.showGrid = e.target.checked;
    });
    
    particlesCheckbox.addEventListener('change', (e) => {
        appState.particlesEnabled = e.target.checked;
    });
    
    sleepEnabledCheckbox.addEventListener('change', (e) => {
        appState.sleepEnabled = e.target.checked;
        physics.sleepThreshold = e.target.checked ? 0.1 : 0;
    });
    
    // Инструменты
    function setTool(tool) {
        appState.currentTool = tool;
        appState.jointMode = (tool === 'joint');
        appState.selectedForJoint = null;
        document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
        if (tool === 'select') toolSelect.classList.add('active');
        else if (tool === 'spawn') toolSpawn.classList.add('active');
        else if (tool === 'destroy') toolDestroy.classList.add('active');
        else if (tool === 'freeze') toolFreeze.classList.add('active');
        else if (tool === 'joint') toolJoint.classList.add('active');
    }
    
    toolSelect.addEventListener('click', () => setTool('select'));
    toolSpawn.addEventListener('click', () => setTool('spawn'));
    toolDestroy.addEventListener('click', () => setTool('destroy'));
    toolFreeze.addEventListener('click', () => setTool('freeze'));
    toolJoint.addEventListener('click', () => setTool('joint'));
    
    pauseBtn.addEventListener('click', () => {
        appState.isPaused = !appState.isPaused;
        pauseBtn.textContent = appState.isPaused ? '▶️ Продолжить' : '⏸️ Пауза';
    });
    
    // Создание объектов
    function createCircle(x, y, radius) {
        const circle = new Circle(x, y, radius);
        circle.restitution = parseFloat(bounceSlider.value);
        return circle;
    }
    
    function createRectangle(x, y, width, height) {
        const rect = new Rectangle(x, y, width, height);
        rect.restitution = parseFloat(bounceSlider.value);
        return rect;
    }
    
    function createTriangle(x, y, size) {
        const triangle = new Polygon(x, y, [
            new Vector2(0, -size),
            new Vector2(size, size),
            new Vector2(-size, size)
        ]);
        triangle.restitution = parseFloat(bounceSlider.value);
        return triangle;
    }
    
    addBallBtn.addEventListener('click', () => {
        for (let i = 0; i < 3; i++) {
            const x = Math.random() * (canvas.width - 100) + 50;
            const y = Math.random() * 100 + 50;
            const radius = Math.random() * 20 + 15;
            const circle = createCircle(x, y, radius);
            circle.velocity = new Vector2((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
            physics.addObject(circle);
        }
    });
    
    addBoxBtn.addEventListener('click', () => {
        for (let i = 0; i < 3; i++) {
            const x = Math.random() * (canvas.width - 100) + 50;
            const y = Math.random() * 100 + 50;
            const width = Math.random() * 30 + 30;
            const height = Math.random() * 30 + 30;
            const rect = createRectangle(x, y, width, height);
            rect.velocity = new Vector2((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
            rect.angularVelocity = (Math.random() - 0.5) * 5;
            physics.addObject(rect);
        }
    });
    
    addTriangleBtn.addEventListener('click', () => {
        for (let i = 0; i < 3; i++) {
            const x = Math.random() * (canvas.width - 100) + 50;
            const y = Math.random() * 100 + 50;
            const size = Math.random() * 20 + 20;
            const triangle = createTriangle(x, y, size);
            triangle.velocity = new Vector2((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
            physics.addObject(triangle);
        }
    });
    
    addStackBtn.addEventListener('click', () => {
        const startX = canvas.width / 2 - 60;
        const startY = canvas.height - 50;
        const boxSize = 40;
        
        for (let row = 0; row < 6; row++) {
            for (let col = 0; col < 3; col++) {
                const x = startX + col * boxSize + (row % 2) * (boxSize / 2);
                const y = startY - row * boxSize - boxSize / 2;
                const rect = createRectangle(x, y, boxSize - 2, boxSize - 2);
                physics.addObject(rect);
            }
        }
    });
    
    addRainBtn.addEventListener('click', () => {
        for (let i = 0; i < 50; i++) {
            const x = Math.random() * canvas.width;
            const y = Math.random() * 100 - 50;
            const radius = Math.random() * 8 + 5;
            const circle = createCircle(x, y, radius);
            circle.velocity = new Vector2((Math.random() - 0.5) * 50, Math.random() * 100 + 50);
            physics.addObject(circle);
        }
    });
    
    clearBtn.addEventListener('click', () => {
        physics.clear();
        appState.collisionCount = 0;
    });
    
    // Взаимодействие с мышью
    let isDragging = false;
    let draggedObject = null;
    let lastMouseX = 0;
    let lastMouseY = 0;
    
    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        // Режим создания соединений
        if (appState.currentTool === 'joint') {
            const obj = physics.findObjectAt(x, y);
            if (obj) {
                if (!appState.selectedForJoint) {
                    appState.selectedForJoint = obj;
                    physics.spawnParticles(obj.position.x, obj.position.y, 8, '#ffff00');
                } else if (appState.selectedForJoint !== obj) {
                    // Создаем соединение между двумя объектами
                    const joint = new Joint(
                        appState.selectedForJoint,
                        obj,
                        new Vector2(0, 0),
                        new Vector2(0, 0),
                        null,
                        0.9
                    );
                    physics.addJoint(joint);
                    physics.spawnParticles(obj.position.x, obj.position.y, 10, '#00ff00');
                    appState.selectedForJoint = null;
                }
            } else if (appState.selectedForJoint) {
                // Сброс выделения при клике на пустое место
                appState.selectedForJoint = null;
            }
            e.preventDefault();
            return;
        }
        
        if (e.button === 2 || appState.currentTool === 'destroy') {
            const obj = physics.findObjectAt(x, y);
            if (obj) {
                if (appState.particlesEnabled) {
                    physics.spawnParticles(obj.position.x, obj.position.y, 15, obj.color);
                }
                physics.removeObject(obj.id);
            }
            e.preventDefault();
        } else if (e.button === 0 || appState.currentTool === 'select' || appState.currentTool === 'spawn') {
            const obj = physics.findObjectAt(x, y);
            if (obj) {
                if (appState.currentTool === 'freeze') {
                    obj.static = !obj.static;
                    obj.invMass = obj.static ? 0 : 1 / obj.mass;
                    obj.momentOfInertia = obj.static ? Infinity : obj.momentOfInertia;
                } else {
                    isDragging = true;
                    draggedObject = obj;
                    lastMouseX = x;
                    lastMouseY = y;
                    obj.velocity = Vector2.zero();
                    obj.angularVelocity = 0;
                    obj.wakeUp();
                }
            } else if (appState.currentTool === 'spawn' || e.button === 0) {
                const circle = createCircle(x, y, 20);
                physics.addObject(circle);
            }
        }
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (isDragging && draggedObject) {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const dx = x - lastMouseX;
            const dy = y - lastMouseY;
            
            draggedObject.position.x = x;
            draggedObject.position.y = y;
            draggedObject.velocity = new Vector2(dx * 60, dy * 60);
            
            lastMouseX = x;
            lastMouseY = y;
        }
    });
    
    canvas.addEventListener('mouseup', () => {
        isDragging = false;
        draggedObject = null;
    });
    
    canvas.addEventListener('mouseleave', () => {
        isDragging = false;
        draggedObject = null;
    });
    
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Отрисовка фона и сетки
    function renderBackground() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Градиентный фон
        const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
        gradient.addColorStop(0, '#1a1a2e');
        gradient.addColorStop(1, '#16213e');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем сетку
        if (appState.showGrid) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.lineWidth = 1;
            const gridSize = 50;
            
            for (let x = 0; x < canvas.width; x += gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
        }
        
        // Рисуем границы
        ctx.strokeStyle = 'rgba(102, 126, 234, 0.3)';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    }
    
    // Игровой цикл
    let lastTime = performance.now();
    let lastFrameTime = 16;
    let frameCount = 0;
    let fpsUpdateTime = 0;
    
    function gameLoop(currentTime) {
        const deltaTime = (currentTime - lastTime) / 1000;
        lastTime = currentTime;
        lastFrameTime = deltaTime * 1000;
        
        // Подсчет FPS
        frameCount++;
        if (currentTime - fpsUpdateTime >= 1000) {
            const fps = Math.round(frameCount * 1000 / (currentTime - fpsUpdateTime));
            statFps.textContent = fps;
            infoFps.textContent = fps;
            frameCount = 0;
            fpsUpdateTime = currentTime;
        }
        
        if (!appState.isPaused) {
            // Обновляем физику с учетом масштаба времени
            const scaledDelta = deltaTime * appState.timeScale;
            physics.update(scaledDelta);
            
            // Подсчет коллизий
            if (physics.lastCollisionCount !== undefined) {
                appState.collisionCount = physics.lastCollisionCount;
            }
        }
        
        // Рендерим
        renderBackground();
        physics.draw(ctx);
        
        // Обновляем статистику
        statObjects.textContent = physics.objects.length;
        statParticles.textContent = physics.particles.length;
        statCollisions.textContent = appState.collisionCount;
        statJoints.textContent = physics.joints.length;
        infoObjects.textContent = physics.objects.length;
        infoParticles.textContent = physics.particles.length;
        infoJoints.textContent = physics.joints.length;
        
        requestAnimationFrame(gameLoop);
    }
    
    // Запуск
    fpsUpdateTime = performance.now();
    requestAnimationFrame(gameLoop);
});
