/**
 * Основная логика симуляции песочницы
 * Расширенная версия с поддержкой нового физического движка
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Устанавливаем размер канваса
    canvas.width = 800;
    canvas.height = 500;
    
    // Инициализация физического движка
    const physics = new PhysicsEngine(canvas.width, canvas.height, 9.8, 0.7);
    
    // Элементы управления
    const addBallBtn = document.getElementById('addBall');
    const addBoxBtn = document.getElementById('addBox');
    const clearBtn = document.getElementById('clear');
    const gravitySlider = document.getElementById('gravity');
    const gravityValue = document.getElementById('gravityValue');
    const bounceSlider = document.getElementById('bounce');
    const bounceValue = document.getElementById('bounceValue');
    
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
        
        // Обновляем restitution у всех объектов
        physics.objects.forEach(obj => {
            obj.restitution = value;
        });
    });
    
    // Обработчики кнопок
    addBallBtn.addEventListener('click', () => {
        const x = Math.random() * (canvas.width - 100) + 50;
        const y = Math.random() * 100 + 50;
        const radius = Math.random() * 20 + 15;
        const circle = createCircle(x, y, radius);
        // Добавляем начальную скорость
        circle.velocity = new Vector2((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
        physics.addObject(circle);
    });
    
    addBoxBtn.addEventListener('click', () => {
        const x = Math.random() * (canvas.width - 100) + 50;
        const y = Math.random() * 100 + 50;
        const width = Math.random() * 30 + 30;
        const height = Math.random() * 30 + 30;
        const rect = createRectangle(x, y, width, height);
        // Добавляем начальную скорость и вращение
        rect.velocity = new Vector2((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 100);
        rect.angularVelocity = (Math.random() - 0.5) * 5;
        physics.addObject(rect);
    });
    
    clearBtn.addEventListener('click', () => {
        physics.clear();
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
        
        if (e.button === 2) { // Правый клик - удаление
            const obj = physics.findObjectAt(x, y);
            if (obj) {
                // Создаем эффект взрыва частиц при удалении
                physics.spawnParticles(obj.position.x, obj.position.y, 10, obj.color);
                physics.removeObject(obj.id);
            }
            e.preventDefault();
        } else if (e.button === 0) { // Левый клик
            const obj = physics.findObjectAt(x, y);
            if (obj) {
                isDragging = true;
                draggedObject = obj;
                lastMouseX = x;
                lastMouseY = y;
                obj.velocity = Vector2.zero();
                obj.angularVelocity = 0;
                obj.wakeUp();
            } else {
                // Добавляем круг в позицию клика
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
        gradient.addColorStop(0, '#f5f7fa');
        gradient.addColorStop(1, '#c3cfe2');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем сетку
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
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
        
        // Рисуем границы
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.lineWidth = 4;
        ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    }
    
    // Отрисовка информации
    function renderInfo() {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.font = '14px "Segoe UI", Arial, sans-serif';
        ctx.fillText(`Объектов: ${physics.objects.length}`, 10, 25);
        ctx.fillText(`Частиц: ${physics.particles.length}`, 10, 45);
        ctx.fillText(`FPS: ${Math.round(1000 / (lastFrameTime || 16))}`, 10, 65);
    }
    
    // Игровой цикл
    let lastTime = performance.now();
    let lastFrameTime = 16;
    
    function gameLoop(currentTime) {
        const deltaTime = (currentTime - lastTime) / 1000; // Конвертируем в секунды
        lastTime = currentTime;
        lastFrameTime = deltaTime * 1000;
        
        // Обновляем физику
        physics.update(deltaTime);
        
        // Рендерим
        renderBackground();
        physics.draw(ctx);
        renderInfo();
        
        requestAnimationFrame(gameLoop);
    }
    
    // Запуск
    requestAnimationFrame(gameLoop);
});
