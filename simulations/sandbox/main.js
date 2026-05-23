/**
 * Основная логика симуляции песочницы
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    
    // Инициализация физического движка
    const physics = new PhysicsEngine(9.8, 0.7);
    physics.width = canvas.width;
    physics.height = canvas.height;
    
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
        physics.gravity = parseFloat(gravitySlider.value);
        gravityValue.textContent = physics.gravity.toFixed(1);
    });
    
    bounceSlider.addEventListener('input', () => {
        physics.bounce = parseFloat(bounceSlider.value);
        bounceValue.textContent = physics.bounce.toFixed(2);
    });
    
    // Обработчики кнопок
    addBallBtn.addEventListener('click', () => {
        const x = Math.random() * (canvas.width - 100) + 50;
        const y = Math.random() * 100 + 50;
        const radius = Math.random() * 20 + 15;
        physics.addObject(createBall(x, y, radius));
    });
    
    addBoxBtn.addEventListener('click', () => {
        const x = Math.random() * (canvas.width - 100) + 50;
        const y = Math.random() * 100 + 50;
        const width = Math.random() * 30 + 30;
        const height = Math.random() * 30 + 30;
        physics.addObject(createBox(x, y, width, height));
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
                obj.vx = 0;
                obj.vy = 0;
            } else {
                // Добавляем шар в позицию клика
                physics.addObject(createBall(x, y, 20));
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
            
            draggedObject.x = x;
            draggedObject.y = y;
            draggedObject.vx = dx * 2;
            draggedObject.vy = dy * 2;
            
            lastMouseX = x;
            lastMouseY = y;
        }
    });
    
    canvas.addEventListener('mouseup', () => {
        isDragging = false;
        draggedObject = null;
    });
    
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Отрисовка
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Рисуем сетку
        ctx.strokeStyle = '#e0e0e0';
        ctx.lineWidth = 1;
        for (let x = 0; x < canvas.width; x += 50) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }
        for (let y = 0; y < canvas.height; y += 50) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }
        
        // Рисуем объекты
        physics.objects.forEach(obj => {
            ctx.fillStyle = obj.color;
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            
            if (obj.type === 'ball') {
                ctx.beginPath();
                ctx.arc(obj.x, obj.y, obj.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                
                // Индикатор вращения
                ctx.beginPath();
                ctx.moveTo(obj.x, obj.y);
                ctx.lineTo(
                    obj.x + Math.cos(obj.angle) * obj.radius,
                    obj.y + Math.sin(obj.angle) * obj.radius
                );
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.stroke();
            } else if (obj.type === 'box') {
                ctx.save();
                ctx.translate(obj.x, obj.y);
                ctx.rotate(obj.angle);
                ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
                ctx.strokeRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
                ctx.restore();
            }
        });
        
        // Информация об объектах
        ctx.fillStyle = '#333';
        ctx.font = '14px Arial';
        ctx.fillText(`Объектов: ${physics.objects.length}`, 10, 20);
    }
    
    // Игровой цикл
    let lastTime = performance.now();
    
    function gameLoop(currentTime) {
        const deltaTime = currentTime - lastTime;
        lastTime = currentTime;
        
        physics.update(deltaTime);
        render();
        
        requestAnimationFrame(gameLoop);
    }
    
    // Запуск
    requestAnimationFrame(gameLoop);
});
