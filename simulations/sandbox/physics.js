/**
 * Физический движок для песочницы
 * Расширенная реализация физики твердых тел с гравитацией, столкновениями,
 * системой частиц, трением и дополнительными эффектами
 */

class Vector2 {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        return new Vector2(this.x + v.x, this.y + v.y);
    }

    sub(v) {
        return new Vector2(this.x - v.x, this.y - v.y);
    }

    multiply(scalar) {
        return new Vector2(this.x * scalar, this.y * scalar);
    }

    divide(scalar) {
        if (scalar === 0) return new Vector2(0, 0);
        return new Vector2(this.x / scalar, this.y / scalar);
    }

    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    normalize() {
        const mag = this.magnitude();
        if (mag === 0) return new Vector2(0, 0);
        return this.divide(mag);
    }

    dot(v) {
        return this.x * v.x + this.y * v.y;
    }

    cross(v) {
        return this.x * v.y - this.y * v.x;
    }

    distance(v) {
        return this.sub(v).magnitude();
    }

    clone() {
        return new Vector2(this.x, this.y);
    }

    static zero() {
        return new Vector2(0, 0);
    }

    static up() {
        return new Vector2(0, -1);
    }

    static down() {
        return new Vector2(0, 1);
    }

    static left() {
        return new Vector2(-1, 0);
    }

    static right() {
        return new Vector2(1, 0);
    }
}

class PhysicsObject {
    constructor(x, y, type) {
        this.id = Date.now() + Math.random() + Math.random();
        this.position = new Vector2(x, y);
        this.velocity = new Vector2(0, 0);
        this.acceleration = new Vector2(0, 0);
        this.type = type;
        this.mass = 1;
        this.invMass = 1;
        this.restitution = 0.7;
        this.friction = 0.98;
        this.static = false;
        this.color = this.generateColor();
        this.angle = 0;
        this.angularVelocity = 0;
        this.angularAcceleration = 0;
        this.momentOfInertia = 1;
        this.isSleeping = false;
        this.sleepTimer = 0;
    }

    generateColor() {
        const hue = Math.floor(Math.random() * 360);
        const saturation = 70 + Math.random() * 20;
        const lightness = 45 + Math.random() * 15;
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    applyForce(force) {
        if (this.static) return;
        const acc = force.divide(this.mass);
        this.acceleration = this.acceleration.add(acc);
    }

    applyImpulse(impulse) {
        if (this.static) return;
        const velocityChange = impulse.divide(this.mass);
        this.velocity = this.velocity.add(velocityChange);
    }

    applyTorque(torque) {
        if (this.static) return;
        this.angularAcceleration += torque / this.momentOfInertia;
    }

    wakeUp() {
        this.isSleeping = false;
        this.sleepTimer = 0;
    }

    trySleep(threshold) {
        if (this.static) {
            this.isSleeping = true;
            return;
        }

        const speed = this.velocity.magnitude();
        const angularSpeed = Math.abs(this.angularVelocity);

        if (speed < threshold && angularSpeed < threshold * 2) {
            this.sleepTimer++;
            if (this.sleepTimer > 60) {
                this.isSleeping = true;
                this.velocity = Vector2.zero();
                this.angularVelocity = 0;
            }
        } else {
            this.sleepTimer = 0;
            this.isSleeping = false;
        }
    }

    integrate(dt, gravity, damping) {
        if (this.static || this.isSleeping) return;

        // Применяем гравитацию
        this.acceleration = this.acceleration.add(gravity);

        // Интегрируем скорость (полунеявный Эйлер)
        this.velocity = this.velocity.add(this.acceleration.multiply(dt));
        this.velocity = this.velocity.multiply(damping);

        // Интегрируем позицию
        this.position = this.position.add(this.velocity.multiply(dt));

        // Интегрируем вращение
        this.angularVelocity += this.angularAcceleration * dt;
        this.angularVelocity *= 0.99; // Угловое затухание
        this.angle += this.angularVelocity * dt;

        // Сбрасываем ускорение
        this.acceleration = Vector2.zero();
        this.angularAcceleration = 0;
    }
}

class Circle extends PhysicsObject {
    constructor(x, y, radius) {
        super(x, y, 'circle');
        this.radius = radius;
        this.mass = radius * radius * Math.PI * 0.001;
        this.invMass = this.static ? 0 : 1 / this.mass;
        this.momentOfInertia = 0.5 * this.mass * radius * radius;
        if (this.static) this.momentOfInertia = Infinity;
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.position.x, this.position.y);
        ctx.rotate(this.angle);

        // Основной круг
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Индикатор вращения
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(this.angle) * this.radius * 0.8, Math.sin(this.angle) * this.radius * 0.8);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Блик
        ctx.beginPath();
        ctx.arc(-this.radius * 0.3, -this.radius * 0.3, this.radius * 0.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fill();

        ctx.restore();
    }

    getBounds() {
        return {
            left: this.position.x - this.radius,
            right: this.position.x + this.radius,
            top: this.position.y - this.radius,
            bottom: this.position.y + this.radius
        };
    }
}

class Rectangle extends PhysicsObject {
    constructor(x, y, width, height) {
        super(x, y, 'rectangle');
        this.width = width;
        this.height = height;
        this.mass = width * height * 0.001;
        this.invMass = this.static ? 0 : 1 / this.mass;
        this.momentOfInertia = (1/12) * this.mass * (width * width + height * height);
        if (this.static) this.momentOfInertia = Infinity;
    }

    getVertices() {
        const cos = Math.cos(this.angle);
        const sin = Math.sin(this.angle);
        const hw = this.width / 2;
        const hh = this.height / 2;

        const corners = [
            new Vector2(-hw, -hh),
            new Vector2(hw, -hh),
            new Vector2(hw, hh),
            new Vector2(-hw, hh)
        ];

        return corners.map(v => {
            return new Vector2(
                this.position.x + v.x * cos - v.y * sin,
                this.position.y + v.x * sin + v.y * cos
            );
        });
    }

    draw(ctx) {
        ctx.save();
        ctx.translate(this.position.x, this.position.y);
        ctx.rotate(this.angle);

        // Основная фигура
        ctx.fillStyle = this.color;
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        
        // Границы
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);

        // Диагонали для визуализации вращения
        ctx.beginPath();
        ctx.moveTo(-this.width / 2, -this.height / 2);
        ctx.lineTo(this.width / 2, this.height / 2);
        ctx.moveTo(this.width / 2, -this.height / 2);
        ctx.lineTo(-this.width / 2, this.height / 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
    }

    getBounds() {
        const vertices = this.getVertices();
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const v of vertices) {
            minX = Math.min(minX, v.x);
            maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y);
            maxY = Math.max(maxY, v.y);
        }

        return { left: minX, right: maxX, top: minY, bottom: maxY };
    }
}

class Particle {
    constructor(x, y, vx, vy, color, life) {
        this.position = new Vector2(x, y);
        this.velocity = new Vector2(vx, vy);
        this.color = color;
        this.life = life;
        this.maxLife = life;
        this.size = 2 + Math.random() * 3;
        this.alpha = 1;
    }

    update(dt) {
        this.position = this.position.add(this.velocity.multiply(dt));
        this.velocity.y += 200 * dt; // Гравитация для частиц
        this.life -= dt;
        this.alpha = this.life / this.maxLife;
    }

    isDead() {
        return this.life <= 0;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.position.x, this.position.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

class PhysicsEngine {
    constructor(width, height, gravity = 9.8, bounce = 0.7) {
        this.gravity = new Vector2(0, gravity);
        this.bounce = bounce;
        this.damping = 0.999;
        this.objects = [];
        this.particles = [];
        this.width = width;
        this.height = height;
        this.spatialGrid = null;
        this.cellSize = 50;
        this.iterations = 8;
        this.sleepThreshold = 0.1;
    }

    addObject(obj) {
        this.objects.push(obj);
        this.rebuildSpatialGrid();
        return obj;
    }

    removeObject(id) {
        const index = this.objects.findIndex(obj => obj.id === id);
        if (index !== -1) {
            this.objects.splice(index, 1);
            this.rebuildSpatialGrid();
        }
    }

    clear() {
        this.objects = [];
        this.particles = [];
        this.spatialGrid = null;
    }

    spawnParticles(x, y, count, color) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 50 + Math.random() * 150;
            const vx = Math.cos(angle) * speed;
            const vy = Math.sin(angle) * speed;
            this.particles.push(new Particle(x, y, vx, vy, color, 1 + Math.random()));
        }
    }

    rebuildSpatialGrid() {
        const cols = Math.ceil(this.width / this.cellSize);
        const rows = Math.ceil(this.height / this.cellSize);
        this.spatialGrid = new Array(cols * rows).fill(null).map(() => []);

        for (const obj of this.objects) {
            const bounds = obj.getBounds();
            const minCol = Math.max(0, Math.floor(bounds.left / this.cellSize));
            const maxCol = Math.min(cols - 1, Math.floor(bounds.right / this.cellSize));
            const minRow = Math.max(0, Math.floor(bounds.top / this.cellSize));
            const maxRow = Math.min(rows - 1, Math.floor(bounds.bottom / this.cellSize));

            for (let col = minCol; col <= maxCol; col++) {
                for (let row = minRow; row <= maxRow; row++) {
                    this.spatialGrid[row * cols + col].push(obj);
                }
            }
        }
    }

    getPotentialCollisions() {
        const pairs = [];
        const checked = new Set();

        if (!this.spatialGrid) return pairs;

        const cols = Math.ceil(this.width / this.cellSize);

        for (const cell of this.spatialGrid) {
            for (let i = 0; i < cell.length; i++) {
                for (let j = i + 1; j < cell.length; j++) {
                    const obj1 = cell[i];
                    const obj2 = cell[j];
                    const key = obj1.id < obj2.id ? `${obj1.id}-${obj2.id}` : `${obj2.id}-${obj1.id}`;
                    
                    if (!checked.has(key)) {
                        checked.add(key);
                        pairs.push([obj1, obj2]);
                    }
                }
            }
        }

        return pairs;
    }

    update(dt) {
        // Ограничиваем dt для стабильности
        dt = Math.min(dt, 0.033);

        // Обновляем частицы
        for (let i = this.particles.length - 1; i >= 0; i--) {
            this.particles[i].update(dt);
            if (this.particles[i].isDead()) {
                this.particles.splice(i, 1);
            }
        }

        // Пробуждаем объекты
        for (const obj of this.objects) {
            obj.wakeUp();
        }

        // Интегрируем позиции
        for (const obj of this.objects) {
            obj.integrate(dt, this.gravity, this.damping);
        }

        // Ограничиваем объекты границами
        for (const obj of this.objects) {
            this.constrainToBounds(obj);
        }

        // Перестраиваем пространственную сетку
        this.rebuildSpatialGrid();

        // Решаем коллизии
        const pairs = this.getPotentialCollisions();
        for (let i = 0; i < this.iterations; i++) {
            for (const [obj1, obj2] of pairs) {
                if (this.checkCollision(obj1, obj2)) {
                    this.resolveCollision(obj1, obj2);
                }
            }
        }

        // Проверяем сон
        for (const obj of this.objects) {
            obj.trySleep(this.sleepThreshold);
        }
    }

    constrainToBounds(obj) {
        const bounds = obj.getBounds();
        const padding = 1;

        // Левая граница
        if (bounds.left < padding) {
            const penetration = padding - bounds.left;
            if (obj.type === 'circle') {
                obj.position.x += penetration;
            } else {
                obj.position.x += penetration;
            }
            obj.velocity.x *= -this.bounce * 0.5;
            obj.angularVelocity *= 0.9;
        }

        // Правая граница
        if (bounds.right > this.width - padding) {
            const penetration = bounds.right - (this.width - padding);
            if (obj.type === 'circle') {
                obj.position.x -= penetration;
            } else {
                obj.position.x -= penetration;
            }
            obj.velocity.x *= -this.bounce * 0.5;
            obj.angularVelocity *= 0.9;
        }

        // Верхняя граница
        if (bounds.top < padding) {
            const penetration = padding - bounds.top;
            if (obj.type === 'circle') {
                obj.position.y += penetration;
            } else {
                obj.position.y += penetration;
            }
            obj.velocity.y *= -this.bounce * 0.5;
            obj.angularVelocity *= 0.9;
        }

        // Нижняя граница
        if (bounds.bottom > this.height - padding) {
            const penetration = bounds.bottom - (this.height - padding);
            if (obj.type === 'circle') {
                obj.position.y -= penetration;
            } else {
                obj.position.y -= penetration;
            }
            
            // Трение о землю
            obj.velocity.x *= 0.95;
            obj.velocity.y *= -this.bounce * 0.3;
            obj.angularVelocity *= 0.95;

            // Создаем частицы при ударе
            if (Math.abs(obj.velocity.y) > 50 && !obj.static) {
                this.spawnParticles(obj.position.x, obj.position.y + (obj.type === 'circle' ? obj.radius : obj.height/2), 3, obj.color);
            }
        }
    }

    checkCollision(obj1, obj2) {
        if (obj1.static && obj2.static) return false;
        if (obj1.isSleeping && obj2.isSleeping) return false;

        const bounds1 = obj1.getBounds();
        const bounds2 = obj2.getBounds();

        // Быстрая проверка AABB
        if (bounds1.right < bounds2.left || bounds1.left > bounds2.right ||
            bounds1.bottom < bounds2.top || bounds1.top > bounds2.bottom) {
            return false;
        }

        // Детальная проверка
        if (obj1.type === 'circle' && obj2.type === 'circle') {
            return this.checkCircleCircle(obj1, obj2);
        } else if (obj1.type === 'circle' && obj2.type === 'rectangle') {
            return this.checkCircleRect(obj1, obj2);
        } else if (obj1.type === 'rectangle' && obj2.type === 'circle') {
            return this.checkCircleRect(obj2, obj1);
        } else if (obj1.type === 'rectangle' && obj2.type === 'rectangle') {
            return this.checkRectRect(obj1, obj2);
        }

        return false;
    }

    checkCircleCircle(c1, c2) {
        const dist = c1.position.distance(c2.position);
        return dist < c1.radius + c2.radius;
    }

    checkCircleRect(circle, rect) {
        const vertices = rect.getVertices();
        let closestDist = Infinity;
        let closestPoint = null;

        // Находим ближайшую точку на прямоугольнике к центру круга
        for (let i = 0; i < vertices.length; i++) {
            const p1 = vertices[i];
            const p2 = vertices[(i + 1) % vertices.length];
            
            const edge = p2.sub(p1);
            const toCircle = circle.position.sub(p1);
            const edgeLen = edge.magnitude();
            
            if (edgeLen === 0) {
                const dist = circle.position.distance(p1);
                if (dist < closestDist) {
                    closestDist = dist;
                    closestPoint = p1;
                }
                continue;
            }

            const t = Math.max(0, Math.min(1, toCircle.dot(edge) / (edgeLen * edgeLen)));
            const closest = p1.add(edge.multiply(t));
            const dist = circle.position.distance(closest);

            if (dist < closestDist) {
                closestDist = dist;
                closestPoint = closest;
            }
        }

        return closestDist < circle.radius;
    }

    checkRectRect(r1, r2) {
        // SAT (Separating Axis Theorem) для прямоугольников
        const axes = [];
        
        // Получаем нормали ребер первого прямоугольника
        const verts1 = r1.getVertices();
        for (let i = 0; i < 4; i++) {
            const edge = verts1[(i + 1) % 4].sub(verts1[i]);
            axes.push(new Vector2(-edge.y, edge.x).normalize());
        }

        // Получаем нормали ребер второго прямоугольника
        const verts2 = r2.getVertices();
        for (let i = 0; i < 4; i++) {
            const edge = verts2[(i + 1) % 4].sub(verts2[i]);
            axes.push(new Vector2(-edge.y, edge.x).normalize());
        }

        // Проверяем каждую ось
        for (const axis of axes) {
            const proj1 = this.projectPolygon(verts1, axis);
            const proj2 = this.projectPolygon(verts2, axis);

            if (proj1.max < proj2.min || proj2.max < proj1.min) {
                return false; // Разделяющая ось найдена
            }
        }

        return true;
    }

    projectPolygon(vertices, axis) {
        let min = Infinity;
        let max = -Infinity;

        for (const v of vertices) {
            const proj = v.dot(axis);
            min = Math.min(min, proj);
            max = Math.max(max, proj);
        }

        return { min, max };
    }

    resolveCollision(obj1, obj2) {
        let normal = Vector2.zero();
        let penetration = 0;

        if (obj1.type === 'circle' && obj2.type === 'circle') {
            const diff = obj2.position.sub(obj1.position);
            const dist = diff.magnitude();
            if (dist === 0) return;
            
            normal = diff.normalize();
            penetration = (obj1.radius + obj2.radius) - dist;
        } else if (obj1.type === 'circle' && obj2.type === 'rectangle') {
            const circle = obj1;
            const rect = obj2;
            const vertices = rect.getVertices();
            
            let closestDist = Infinity;
            let closestPoint = null;
            let closestEdgeNormal = null;

            for (let i = 0; i < vertices.length; i++) {
                const p1 = vertices[i];
                const p2 = vertices[(i + 1) % vertices.length];
                
                const edge = p2.sub(p1);
                const toCircle = circle.position.sub(p1);
                const edgeLen = edge.magnitude();
                
                if (edgeLen === 0) continue;

                const edgeNormal = new Vector2(-edge.y, edge.x).normalize();
                const t = Math.max(0, Math.min(1, toCircle.dot(edge) / (edgeLen * edgeLen)));
                const closest = p1.add(edge.multiply(t));
                const dist = circle.position.distance(closest);

                if (dist < closestDist) {
                    closestDist = dist;
                    closestPoint = closest;
                    
                    // Определяем нормаль
                    const toCenter = circle.position.sub(closest);
                    if (toCenter.magnitude() > 0.001) {
                        closestEdgeNormal = toCenter.normalize();
                    } else {
                        closestEdgeNormal = edgeNormal;
                    }
                }
            }

            if (closestPoint) {
                normal = closestEdgeNormal;
                penetration = circle.radius - closestDist;
            }
        } else if (obj1.type === 'rectangle' && obj2.type === 'rectangle') {
            // Упрощенное разрешение для прямоугольников
            const centerDiff = obj2.position.sub(obj1.position);
            
            if (Math.abs(centerDiff.x) > Math.abs(centerDiff.y)) {
                normal = new Vector2(Math.sign(centerDiff.x), 0);
                penetration = (obj1.width + obj2.width) / 2 - Math.abs(centerDiff.x);
            } else {
                normal = new Vector2(0, Math.sign(centerDiff.y));
                penetration = (obj1.height + obj2.height) / 2 - Math.abs(centerDiff.y);
            }
        }

        if (penetration <= 0) return;

        // Позиционная коррекция
        const totalInvMass = obj1.invMass + obj2.invMass;
        if (totalInvMass === 0) return;

        const correction = normal.multiply(penetration / totalInvMass);
        if (!obj1.static) {
            obj1.position = obj1.position.sub(correction.multiply(obj1.invMass));
        }
        if (!obj2.static) {
            obj2.position = obj2.position.add(correction.multiply(obj2.invMass));
        }

        // Импульсная коррекция
        const relVel = obj2.velocity.sub(obj1.velocity);
        const velAlongNormal = relVel.dot(normal);

        if (velAlongNormal > 0) return;

        const e = Math.min(obj1.restitution, obj2.restitution);
        let j = -(1 + e) * velAlongNormal;
        j /= totalInvMass;

        const impulse = normal.multiply(j);
        if (!obj1.static) {
            obj1.velocity = obj1.velocity.sub(impulse.multiply(obj1.invMass));
        }
        if (!obj2.static) {
            obj2.velocity = obj2.velocity.add(impulse.multiply(obj2.invMass));
        }

        // Касательный импульс (трение)
        const tangent = relVel.sub(normal.multiply(relVel.dot(normal)));
        if (tangent.magnitude() > 0.001) {
            const tangentNorm = tangent.normalize();
            const mu = 0.3; // Коэффициент трения
            
            let jt = -relVel.dot(tangentNorm);
            jt /= totalInvMass;

            // Ограничиваем трение
            const maxFriction = j * mu;
            if (Math.abs(jt) > maxFriction) {
                jt = Math.sign(jt) * maxFriction;
            }

            const frictionImpulse = tangentNorm.multiply(jt);
            if (!obj1.static) {
                obj1.velocity = obj1.velocity.sub(frictionImpulse.multiply(obj1.invMass));
            }
            if (!obj2.static) {
                obj2.velocity = obj2.velocity.add(frictionImpulse.multiply(obj2.invMass));
            }
        }
    }

    findObjectAt(x, y) {
        for (let i = this.objects.length - 1; i >= 0; i--) {
            const obj = this.objects[i];
            const bounds = obj.getBounds();
            
            if (x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom) {
                if (obj.type === 'circle') {
                    const dist = obj.position.distance(new Vector2(x, y));
                    if (dist <= obj.radius) {
                        return obj;
                    }
                } else {
                    return obj;
                }
            }
        }
        return null;
    }

    draw(ctx) {
        // Рисуем частицы
        for (const particle of this.particles) {
            particle.draw(ctx);
        }

        // Рисуем объекты
        for (const obj of this.objects) {
            obj.draw(ctx);
        }
    }
}

// Фабрика объектов
function createCircle(x, y, radius, static = false) {
    const circle = new Circle(x, y, radius);
    circle.static = static;
    if (static) {
        circle.invMass = 0;
        circle.momentOfInertia = Infinity;
    }
    return circle;
}

function createRectangle(x, y, width, height, static = false) {
    const rect = new Rectangle(x, y, width, height);
    rect.static = static;
    if (static) {
        rect.invMass = 0;
        rect.momentOfInertia = Infinity;
    }
    return rect;
}
