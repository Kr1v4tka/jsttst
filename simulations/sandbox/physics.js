/**
 * Физический движок для песочницы
 * Реализует простую физику твердых тел с гравитацией и столкновениями
 */

class PhysicsEngine {
    constructor(gravity = 9.8, bounce = 0.7) {
        this.gravity = gravity;
        this.bounce = bounce;
        this.objects = [];
        this.width = 800;
        this.height = 500;
    }

    addObject(obj) {
        obj.id = Date.now() + Math.random();
        this.objects.push(obj);
        return obj;
    }

    removeObject(id) {
        this.objects = this.objects.filter(obj => obj.id !== id);
    }

    clear() {
        this.objects = [];
    }

    update(deltaTime) {
        const dt = deltaTime / 1000; // Конвертируем в секунды
        
        this.objects.forEach(obj => {
            // Применяем гравитацию
            if (!obj.static) {
                obj.vy += this.gravity * dt;
                
                // Обновляем позицию
                obj.x += obj.vx * dt * 50;
                obj.y += obj.vy * dt * 50;
                
                // Вращение
                if (obj.angle !== undefined) {
                    obj.angle += obj.angularVel * dt;
                }
                
                // Столкновения с границами
                this.handleBoundaryCollisions(obj);
            }
        });
        
        // Проверка столкновений между объектами
        this.checkCollisions();
    }

    handleBoundaryCollisions(obj) {
        const padding = obj.type === 'ball' ? obj.radius : obj.width / 2;
        
        // Левая граница
        if (obj.x - padding < 0) {
            obj.x = padding;
            obj.vx = -obj.vx * this.bounce;
        }
        
        // Правая граница
        if (obj.x + padding > this.width) {
            obj.x = this.width - padding;
            obj.vx = -obj.vx * this.bounce;
        }
        
        // Верхняя граница
        if (obj.y - padding < 0) {
            obj.y = padding;
            obj.vy = -obj.vy * this.bounce;
        }
        
        // Нижняя граница
        if (obj.y + padding > this.height) {
            obj.y = this.height - padding;
            obj.vy = -obj.vy * this.bounce;
            
            // Трение о землю
            obj.vx *= 0.98;
        }
    }

    checkCollisions() {
        for (let i = 0; i < this.objects.length; i++) {
            for (let j = i + 1; j < this.objects.length; j++) {
                const obj1 = this.objects[i];
                const obj2 = this.objects[j];
                
                if (obj1.static && obj2.static) continue;
                
                if (obj1.type === 'ball' && obj2.type === 'ball') {
                    this.handleBallBallCollision(obj1, obj2);
                } else if (obj1.type === 'ball' && obj2.type === 'box') {
                    this.handleBallBoxCollision(obj1, obj2);
                } else if (obj1.type === 'box' && obj2.type === 'ball') {
                    this.handleBallBoxCollision(obj2, obj1);
                } else if (obj1.type === 'box' && obj2.type === 'box') {
                    this.handleBoxBoxCollision(obj1, obj2);
                }
            }
        }
    }

    handleBallBallCollision(ball1, ball2) {
        const dx = ball2.x - ball1.x;
        const dy = ball2.y - ball1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDist = ball1.radius + ball2.radius;
        
        if (distance < minDist && distance > 0) {
            // Нормаль столкновения
            const nx = dx / distance;
            const ny = dy / distance;
            
            // Относительная скорость
            const dvx = ball1.vx - ball2.vx;
            const dvy = ball1.vy - ball2.vy;
            
            // Скалярное произведение скорости и нормали
            const dvn = dvx * nx + dvy * ny;
            
            // Если объекты удаляются друг от друга, пропускаем
            if (dvn < 0) return;
            
            // Импульс
            const restitution = this.bounce;
            const totalMass = ball1.mass + ball2.mass;
            const impulse = (-(1 + restitution) * dvn) / totalMass;
            
            if (!ball1.static) {
                ball1.vx += impulse * ball2.mass * nx;
                ball1.vy += impulse * ball2.mass * ny;
            }
            
            if (!ball2.static) {
                ball2.vx -= impulse * ball1.mass * nx;
                ball2.vy -= impulse * ball1.mass * ny;
            }
            
            // Разделяем объекты
            const overlap = minDist - distance;
            const separationX = (overlap / 2) * nx;
            const separationY = (overlap / 2) * ny;
            
            if (!ball1.static) {
                ball1.x -= separationX;
                ball1.y -= separationY;
            }
            if (!ball2.static) {
                ball2.x += separationX;
                ball2.y += separationY;
            }
        }
    }

    handleBallBoxCollision(ball, box) {
        // Находим ближайшую точку на коробке к центру шара
        const closestX = Math.max(box.x - box.width / 2, Math.min(ball.x, box.x + box.width / 2));
        const closestY = Math.max(box.y - box.height / 2, Math.min(ball.y, box.y + box.height / 2));
        
        const dx = ball.x - closestX;
        const dy = ball.y - closestY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < ball.radius && distance > 0) {
            const nx = dx / distance;
            const ny = dy / distance;
            
            const dvx = ball.vx;
            const dvy = ball.vy;
            const dvn = dvx * nx + dvy * ny;
            
            if (dvn < 0) return;
            
            const restitution = this.bounce;
            const impulse = -(1 + restitution) * dvn;
            
            if (!ball.static) {
                ball.vx += impulse * nx;
                ball.vy += impulse * ny;
            }
            
            // Разделяем объекты
            const overlap = ball.radius - distance;
            if (!ball.static) {
                ball.x += overlap * nx;
                ball.y += overlap * ny;
            }
        }
    }

    handleBoxBoxCollision(box1, box2) {
        // Упрощенная проверка AABB
        const halfWidth1 = box1.width / 2;
        const halfHeight1 = box1.height / 2;
        const halfWidth2 = box2.width / 2;
        const halfHeight2 = box2.height / 2;
        
        const dx = box2.x - box1.x;
        const dy = box2.y - box1.y;
        
        const overlapX = halfWidth1 + halfWidth2 - Math.abs(dx);
        const overlapY = halfHeight1 + halfHeight2 - Math.abs(dy);
        
        if (overlapX > 0 && overlapY > 0) {
            // Определяем направление столкновения
            if (overlapX < overlapY) {
                // Горизонтальное столкновение
                const nx = dx > 0 ? 1 : -1;
                if (!box1.static) {
                    box1.vx = -box1.vx * this.bounce;
                    box1.x += nx * overlapX / 2;
                }
                if (!box2.static) {
                    box2.vx = -box2.vx * this.bounce;
                    box2.x -= nx * overlapX / 2;
                }
            } else {
                // Вертикальное столкновение
                const ny = dy > 0 ? 1 : -1;
                if (!box1.static) {
                    box1.vy = -box1.vy * this.bounce;
                    box1.y += ny * overlapY / 2;
                }
                if (!box2.static) {
                    box2.vy = -box2.vy * this.bounce;
                    box2.y -= ny * overlapY / 2;
                }
            }
        }
    }

    findObjectAt(x, y) {
        for (let i = this.objects.length - 1; i >= 0; i--) {
            const obj = this.objects[i];
            if (obj.type === 'ball') {
                const dx = x - obj.x;
                const dy = y - obj.y;
                if (dx * dx + dy * dy <= obj.radius * obj.radius) {
                    return obj;
                }
            } else if (obj.type === 'box') {
                if (x >= obj.x - obj.width / 2 && x <= obj.x + obj.width / 2 &&
                    y >= obj.y - obj.height / 2 && y <= obj.y + obj.height / 2) {
                    return obj;
                }
            }
        }
        return null;
    }
}

// Фабрика объектов
function createBall(x, y, radius = 20, static = false) {
    return {
        type: 'ball',
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100,
        radius: radius,
        mass: radius * radius * Math.PI,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`,
        static: static,
        angle: 0,
        angularVel: (Math.random() - 0.5) * 2
    };
}

function createBox(x, y, width = 40, height = 40, static = false) {
    return {
        type: 'box',
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 100,
        vy: (Math.random() - 0.5) * 100,
        width: width,
        height: height,
        mass: width * height,
        color: `hsl(${Math.random() * 360}, 70%, 50%)`,
        static: static,
        angle: Math.random() * Math.PI * 2,
        angularVel: (Math.random() - 0.5) * 2
    };
}
