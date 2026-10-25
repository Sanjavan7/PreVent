import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
const MODELS_3D = {
    uno: {
        url: "/models/uno_board.glb",
        longestDimCm: 6.86,
        position: [-13.2, 0, 0],
        rotation: [0, Math.PI * 0.5, 0],
    },
    lcd: {
        url: "/models/lcd_panel.glb",
        longestDimCm: 8,
        position: [0.4, 0, -9.2],
        rotation: [0, Math.PI, 0],
    },
};
const LAYOUT = {
    spa: new THREE.Vector3(-4.6, 0.85, 0.15),
    driver: new THREE.Vector3(0.55, 0.85, 0),
    ledGreen: new THREE.Vector3(3.35, 0.85, -1.45),
    ledAmber: new THREE.Vector3(4.65, 0.85, -1.45),
    ledRed: new THREE.Vector3(5.95, 0.85, -1.45),
    buzzer: new THREE.Vector3(5.35, 0.85, 1.05),
    motor: new THREE.Vector3(10.2, 0, 1.7),
    supply: new THREE.Vector3(10.1, 0, -2.15),
    trim: new THREE.Vector3(2.4, 0.85, -4.35),
};
const WIRE_COLORS = {
    red: 0xff3030,
    black: 0x202020,
    yellow: 0xfac02a,
    green: 0x35c46b,
    blue: 0x2a8df0,
    white: 0xe8e8e8,
    orange: 0xff8a3d,
    purple: 0xa45ce6,
    gray: 0x9aa3ad,
    brown: 0x8a5a3b,
};
const PIN_MATERIAL = () => new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.4, metalness: 0.85 });
function buildBoard() {
    const board = new THREE.Group();
    const W = 16.5, D = 5.5, H = 0.85;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ color: 0xe8e6dc, roughness: 0.7, metalness: 0.05 }));
    body.position.y = H / 2;
    board.add(body);
    const cnv = document.createElement("canvas");
    cnv.width = 1024;
    cnv.height = 256;
    const g2d = cnv.getContext("2d");
    if (g2d) {
        g2d.fillStyle = "#ece9dd";
        g2d.fillRect(0, 0, cnv.width, cnv.height);
        g2d.fillStyle = "#bcb8a8";
        g2d.fillRect(0, 10, cnv.width, 1);
        g2d.fillRect(0, 246, cnv.width, 1);
        g2d.fillStyle = "#cfcbb9";
        g2d.fillRect(0, 122, cnv.width, 12);
        g2d.fillStyle = "#1a1f24";
        const cols = 60, rows = 14;
        const padX = 8, padY = 8;
        const stepX = (cnv.width - padX * 2) / (cols - 1);
        const stepY = (cnv.height - padY * 2) / (rows - 1);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                g2d.beginPath();
                g2d.arc(padX + col * stepX, padY + row * stepY, 1.6, 0, Math.PI * 2);
                g2d.fill();
            }
        }
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, metalness: 0.04 }));
    face.rotation.x = -Math.PI / 2;
    face.position.y = H + 0.001;
    board.add(face);
    return board;
}
function buildSpa() {
    const part = new THREE.Group();
    const pcbMat = new THREE.MeshStandardMaterial({ color: 0x1f6fb2, roughness: 0.5, metalness: 0.12 });
    part.userData.burnish = [pcbMat];
    const pcb = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.16, 1.55), pcbMat);
    pcb.position.y = 0.28;
    part.add(pcb);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.36, 20), new THREE.MeshStandardMaterial({ color: 0xd5d8dc, roughness: 0.32, metalness: 0.88 }));
    can.position.set(-0.35, 0.54, -0.05);
    part.add(can);
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 12), new THREE.MeshStandardMaterial({ color: 0x141618, roughness: 0.6 }));
    vent.position.set(-0.35, 0.74, -0.05);
    part.add(vent);
    const cnv = document.createElement("canvas");
    cnv.width = 256;
    cnv.height = 64;
    const g2d = cnv.getContext("2d");
    if (g2d) {
        g2d.fillStyle = "#1f6fb2";
        g2d.fillRect(0, 0, cnv.width, cnv.height);
        g2d.fillStyle = "#f4f7fb";
        g2d.font = "600 28px sans-serif";
        g2d.textAlign = "center";
        g2d.textBaseline = "middle";
        g2d.fillText("SPA06", 128, 32);
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 }));
    label.rotation.x = -Math.PI / 2;
    label.position.set(0.45, 0.37, -0.05);
    part.add(label);
    const pinMat = PIN_MATERIAL();
    for (let i = 0; i < 4; i++) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, 0.08), pinMat);
        pin.position.set(-0.75 + i * 0.5, 0.14, 0.72);
        part.add(pin);
    }
    return part;
}
function buildDip16() {
    const part = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.55, metalness: 0.12 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.38, 2.15), bodyMat);
    body.position.y = 0.34;
    part.add(body);
    const cnv = document.createElement("canvas");
    cnv.width = 256;
    cnv.height = 64;
    const g2d = cnv.getContext("2d");
    if (g2d) {
        g2d.fillStyle = "#1a1c1f";
        g2d.fillRect(0, 0, cnv.width, cnv.height);
        g2d.fillStyle = "#d5dde4";
        g2d.font = "600 28px sans-serif";
        g2d.textAlign = "center";
        g2d.textBaseline = "middle";
        g2d.fillText("L293D", 128, 32);
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.22), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.05 }));
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.54;
    part.add(label);
    const notch = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.5 }));
    notch.position.set(0, 0.55, -0.82);
    part.add(notch);
    const pinMat = PIN_MATERIAL();
    const pitch = 0.254;
    for (let i = 0; i < 8; i++) {
        const z = (i - 3.5) * pitch;
        for (const x of [-0.62, 0.62]) {
            const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.05), pinMat);
            pin.position.set(x, 0.08, z);
            part.add(pin);
        }
    }
    return part;
}
function buildLed(hex, idle) {
    const part = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
        color: hex,
        emissive: hex,
        emissiveIntensity: idle,
        roughness: 0.32,
        metalness: 0.04,
    });
    part.userData.lamp = mat;
    part.userData.idle = idle;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.7, 16), mat);
    stem.position.y = 0.52;
    part.add(stem);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
    dome.position.y = 0.87;
    part.add(dome);
    const pinMat = PIN_MATERIAL();
    for (const x of [-0.07, 0.07]) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.28, 0.035), pinMat);
        pin.position.set(x, 0.1, 0);
        part.add(pin);
    }
    const resistor = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 10), new THREE.MeshStandardMaterial({ color: 0xc2a36b, roughness: 0.6 }));
    resistor.rotation.z = Math.PI / 2;
    resistor.position.set(0.38, 0.16, 0.22);
    part.add(resistor);
    return part;
}
function buildBuzzer() {
    const part = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.42, 24), new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.45, metalness: 0.45 }));
    can.position.y = 0.32;
    part.add(can);
    const faceMat = new THREE.MeshStandardMaterial({
        color: 0x15181c,
        emissive: 0xff3040,
        emissiveIntensity: 0,
        roughness: 0.4,
    });
    part.userData.lamp = faceMat;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), faceMat);
    face.rotation.x = -Math.PI / 2;
    face.position.y = 0.51;
    part.add(face);
    const pinMat = PIN_MATERIAL();
    for (const x of [-0.15, 0.15]) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), pinMat);
        pin.position.set(x, 0.1, 0.28);
        part.add(pin);
    }
    return part;
}
function buildTrim() {
    const part = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.62), new THREE.MeshStandardMaterial({ color: 0x1d4e89, roughness: 0.5, metalness: 0.1 }));
    body.position.y = 0.26;
    part.add(body);
    const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xd5d5d5, roughness: 0.3, metalness: 0.85 }));
    screw.position.y = 0.52;
    part.add(screw);
    const pinMat = PIN_MATERIAL();
    for (let i = -1; i <= 1; i++) {
        const pin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), pinMat);
        pin.position.set(i * 0.22, 0.08, 0.24);
        part.add(pin);
    }
    return part;
}
function buildSupply() {
    const part = new THREE.Group();
    const pack = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.05, 1.45), new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.55, metalness: 0.2 }));
    pack.position.y = 0.52;
    part.add(pack);
    const cnv = document.createElement("canvas");
    cnv.width = 256;
    cnv.height = 96;
    const g2d = cnv.getContext("2d");
    if (g2d) {
        g2d.fillStyle = "#2a3138";
        g2d.fillRect(0, 0, cnv.width, cnv.height);
        g2d.fillStyle = "#f2f5f7";
        g2d.font = "600 36px sans-serif";
        g2d.textAlign = "center";
        g2d.textBaseline = "middle";
        g2d.fillText("3–6 V", 128, 48);
    }
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.48), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    label.position.set(0, 0.52, 0.73);
    part.add(label);
    return part;
}
function buildBlower() {
    const unit = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.0, 24), new THREE.MeshStandardMaterial({ color: 0xb8b8b8, roughness: 0.45, metalness: 0.85 }));
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.7;
    unit.add(body);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 12), new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.3, metalness: 0.95 }));
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0.7, 1.3);
    unit.add(shaft);
    const rotor = new THREE.Group();
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0x222a32, roughness: 0.6, metalness: 0.3 }));
    hub.rotation.x = Math.PI / 2;
    rotor.add(hub);
    const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xf2c87a, roughness: 0.5, metalness: 0.1,
        side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    });
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.bezierCurveTo(0.2, 0.4, 1.6, 0.5, 2.2, 0.0);
    bladeShape.bezierCurveTo(1.6, -0.3, 0.4, -0.25, 0, 0);
    for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.ShapeGeometry(bladeShape), bladeMat);
        blade.rotation.z = (i / 3) * Math.PI * 2;
        rotor.add(blade);
    }
    rotor.position.set(0, 0.7, 1.65);
    unit.add(rotor);
    return { unit, rotor };
}
function traceJumper(from, to, color, sag = 1.2) {
    const lift = 0.35;
    const fromUp = new THREE.Vector3(from.x, from.y + lift, from.z);
    const toUp = new THREE.Vector3(to.x, to.y + lift, to.z);
    const peak = new THREE.Vector3().addVectors(fromUp, toUp).multiplyScalar(0.5);
    peak.y += sag;
    const span = from.distanceTo(to);
    peak.x += Math.sin(from.x * 12.9898 + to.z * 78.233) * Math.min(span * 0.03, 0.35);
    peak.z += Math.cos(from.z * 12.9898 + to.x * 78.233) * Math.min(span * 0.03, 0.35);
    const shoulderA = new THREE.Vector3().lerpVectors(fromUp, peak, 0.5);
    const shoulderB = new THREE.Vector3().lerpVectors(peak, toUp, 0.5);
    const curve = new THREE.CatmullRomCurve3([from, fromUp, shoulderA, peak, shoulderB, toUp, to]);
    curve.curveType = "catmullrom";
    curve.tension = 0.55;
    return new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.055, 8, false), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }));
}
function ringAlarm() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.35, 48), new THREE.MeshBasicMaterial({
        color: 0xff3030,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.89;
    ring.renderOrder = 999;
    return ring;
}
function alarmGlow() {
    return new THREE.PointLight(0xff2020, 0, 8, 1.6);
}
function driverPin(n) {
    const pitch = 0.254;
    const index = n <= 8 ? n - 1 : 16 - n;
    const z = (index - 3.5) * pitch;
    const x = n <= 8 ? -0.62 : 0.62;
    return new THREE.Vector3(LAYOUT.driver.x + x, 1.15, LAYOUT.driver.z + z);
}
function buildHarness() {
    const unoDigital = (n) => new THREE.Vector3(-11.4, 1.35, (n / 13) * 5.4 - 2.55);
    const unoAnalog = (n) => new THREE.Vector3(-14.6, 1.35, -0.9 + n * 0.62);
    const uno5v = new THREE.Vector3(-13.5, 1.35, -2.15);
    const uno3v = new THREE.Vector3(-13.5, 1.35, -2.7);
    const unoGnd = new THREE.Vector3(-13.5, 1.35, -1.55);
    const lcdPin = (pinNo) => {
        const pitch = 0.254;
        return new THREE.Vector3(2.2 - (pinNo - 1) * pitch, 3.1, -9.15);
    };
    const railRed = (x) => new THREE.Vector3(x, 0.95, 2.45);
    const railGnd = (x) => new THREE.Vector3(x, 0.95, -2.45);
    const spaPin = (slot) => new THREE.Vector3(LAYOUT.spa.x - 0.75 + slot * 0.5, 1.05, LAYOUT.spa.z + 0.72);
    const ledPin = (at) => new THREE.Vector3(at.x, 1.15, at.z + 0.12);
    const C = WIRE_COLORS;
    const motorA = new THREE.Vector3(LAYOUT.motor.x - 0.15, 0.85, LAYOUT.motor.z - 0.4);
    const motorB = new THREE.Vector3(LAYOUT.motor.x - 0.15, 0.85, LAYOUT.motor.z + 0.4);
    const supplyPos = new THREE.Vector3(LAYOUT.supply.x - 1.15, 0.7, LAYOUT.supply.z + 0.2);
    const supplyNeg = new THREE.Vector3(LAYOUT.supply.x - 1.15, 0.55, LAYOUT.supply.z - 0.2);
    const leads = [
        { from: uno5v, to: railRed(-7.4), color: C.red, sag: 0.7 },
        { from: unoGnd, to: railGnd(-7.4), color: C.black, sag: 0.7 },
        { from: railRed(-7.4), to: railRed(7.4), color: C.red, sag: 0.12 },
        { from: railGnd(-7.4), to: railGnd(7.4), color: C.black, sag: 0.12 },
        { from: railGnd(-4.6), to: spaPin(0), color: C.black, sag: 0.35 },
        { from: uno3v, to: spaPin(1), color: C.orange, sag: 1.15 },
        { from: unoAnalog(4), to: spaPin(2), color: C.blue, sag: 1.05 },
        { from: unoAnalog(5), to: spaPin(3), color: C.yellow, sag: 1.1 },
        { from: unoDigital(5), to: driverPin(1), color: C.green, sag: 1.1 },
        { from: unoDigital(7), to: driverPin(2), color: C.orange, sag: 1.0 },
        { from: unoDigital(8), to: driverPin(7), color: C.blue, sag: 0.9 },
        { from: driverPin(16), to: railRed(0.9), color: C.red, sag: 0.45 },
        { from: driverPin(4), to: railGnd(0.1), color: C.black, sag: 0.2 },
        { from: driverPin(5), to: railGnd(0.4), color: C.black, sag: 0.2 },
        { from: driverPin(12), to: railGnd(0.9), color: C.black, sag: 0.25 },
        { from: driverPin(13), to: railGnd(1.2), color: C.black, sag: 0.25 },
        { from: supplyPos, to: driverPin(8), color: C.orange, sag: 0.8 },
        { from: supplyNeg, to: railGnd(7.2), color: C.black, sag: 0.55 },
        { from: driverPin(3), to: motorA, color: C.gray, sag: 0.7 },
        { from: driverPin(6), to: motorB, color: C.white, sag: 0.75 },
        { from: railGnd(1.6), to: lcdPin(1), color: C.black, sag: 1.1 },
        { from: railRed(1.6), to: lcdPin(2), color: C.red, sag: 1.1 },
        { from: new THREE.Vector3(LAYOUT.trim.x, 1.15, LAYOUT.trim.z), to: lcdPin(3), color: C.brown, sag: 0.6 },
        { from: railRed(2.4), to: new THREE.Vector3(LAYOUT.trim.x - 0.22, 1.05, LAYOUT.trim.z), color: C.red, sag: 0.45 },
        { from: railGnd(2.4), to: new THREE.Vector3(LAYOUT.trim.x + 0.22, 1.05, LAYOUT.trim.z), color: C.black, sag: 0.45 },
        { from: unoDigital(12), to: lcdPin(4), color: C.green, sag: 0.7 },
        { from: railGnd(0.4), to: lcdPin(5), color: C.black, sag: 0.55 },
        { from: unoDigital(11), to: lcdPin(6), color: C.white, sag: 0.7 },
        { from: unoDigital(10), to: lcdPin(11), color: C.orange, sag: 0.65 },
        { from: unoDigital(9), to: lcdPin(12), color: C.purple, sag: 0.65 },
        { from: unoDigital(4), to: lcdPin(13), color: C.gray, sag: 0.6 },
        { from: unoDigital(3), to: lcdPin(14), color: C.brown, sag: 0.6 },
        { from: railRed(3.2), to: lcdPin(15), color: C.red, sag: 1.0 },
        { from: railGnd(3.2), to: lcdPin(16), color: C.black, sag: 1.0 },
        { from: unoDigital(2), to: ledPin(LAYOUT.ledGreen), color: C.green, sag: 0.8 },
        { from: ledPin(LAYOUT.ledGreen), to: railGnd(3.35), color: C.black, sag: 0.2 },
        { from: unoDigital(6), to: ledPin(LAYOUT.ledAmber), color: C.yellow, sag: 0.75 },
        { from: ledPin(LAYOUT.ledAmber), to: railGnd(4.65), color: C.black, sag: 0.2 },
        { from: unoAnalog(1), to: ledPin(LAYOUT.ledRed), color: C.red, sag: 1.15 },
        { from: ledPin(LAYOUT.ledRed), to: railGnd(5.95), color: C.black, sag: 0.2 },
        { from: unoDigital(13), to: new THREE.Vector3(LAYOUT.buzzer.x, 1.15, LAYOUT.buzzer.z), color: C.purple, sag: 0.7 },
        { from: new THREE.Vector3(LAYOUT.buzzer.x, 1.05, LAYOUT.buzzer.z), to: railGnd(5.35), color: C.black, sag: 0.35 },
    ];
    const harness = new THREE.Group();
    for (const lead of leads)
        harness.add(traceJumper(lead.from, lead.to, lead.color, lead.sag ?? 0.5));
    return harness;
}
class AlarmFx {
    constructor(parts) {
        this.parts = parts;
        this.tripped = new Set();
        this.ids = ["spa"];
    }
    set(id, isTripped) {
        if (isTripped)
            this.tripped.add(id);
        else
            this.tripped.delete(id);
    }
    update(t) {
        const pulse01 = 0.5 + 0.5 * Math.sin(t * 6);
        for (const id of this.ids) {
            const part = this.parts[id];
            if (!part)
                continue;
            const tripped = this.tripped.has(id);
            this.burn(part, tripped, pulse01);
            this.ring(part, tripped, pulse01);
            this.flare(part, tripped, pulse01);
        }
    }
    burn(part, tripped, p) {
        const mats = part.userData.burnish ?? [];
        for (const m of mats) {
            if (tripped) {
                m.emissive.setHex(0xff4040);
                m.emissiveIntensity = 1.4 + p * 1.8;
            }
            else {
                m.emissive.setHex(0x000000);
                m.emissiveIntensity = 0;
            }
        }
    }
    ring(part, tripped, p) {
        const ring = part.userData.ring;
        if (!ring)
            return;
        const mat = ring.material;
        if (tripped) {
            mat.opacity = 0.65 + p * 0.3;
            const s = 1.15 + p * 0.45;
            ring.scale.set(s, s, 1);
        }
        else {
            mat.opacity = 0;
            ring.scale.set(1, 1, 1);
        }
    }
    flare(part, tripped, p) {
        const flare = part.userData.flare;
        if (flare)
            flare.intensity = tripped ? 4 + p * 6 : 0;
    }
}
function placePart(rig, parts, key, part, at, withAlarm) {
    part.position.copy(at);
    rig.add(part);
    parts[key] = part;
    if (!withAlarm)
        return;
    const ring = ringAlarm();
    ring.position.set(at.x, 0.89, at.z);
    rig.add(ring);
    part.userData.ring = ring;
    const flare = alarmGlow();
    flare.position.set(at.x, at.y + 1.4, at.z);
    rig.add(flare);
    part.userData.flare = flare;
}
function paintLamp(part, intensity) {
    const mat = part?.userData.lamp;
    if (mat)
        mat.emissiveIntensity = intensity;
}
export async function initScene(canvas, onProgress) {
    const host = canvas.parentElement;
    const width = host?.clientWidth ?? 800;
    const height = host?.clientHeight ?? 480;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(48, Math.max(width, 1) / Math.max(height, 1), 0.1, 500);
    camera.position.set(5, 18, 20);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xddd9d0, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(20, 30, 15);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-15, 12, -10);
    scene.add(fill);
    const bounce = new THREE.DirectionalLight(0xfff2e0, 0.2);
    bounce.position.set(0, -8, 18);
    scene.add(bounce);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({
        color: 0xf0eee8, roughness: 0.9, metalness: 0,
        transparent: true, opacity: 0.9,
    }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    scene.add(ground);
    const MODEL_LIFT = 1.7;
    const rig = new THREE.Group();
    rig.position.y = MODEL_LIFT;
    scene.add(rig);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 90;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(-0.4, 1.2 + MODEL_LIFT, -1.1);
    const parts = { breadboard: buildBoard() };
    rig.add(parts.breadboard);
    placePart(rig, parts, "spa", buildSpa(), LAYOUT.spa, true);
    placePart(rig, parts, "driver", buildDip16(), LAYOUT.driver, false);
    placePart(rig, parts, "ledGreen", buildLed(0x1f9d55, 0.85), LAYOUT.ledGreen, false);
    placePart(rig, parts, "ledAmber", buildLed(0xf0b429, 0.18), LAYOUT.ledAmber, false);
    placePart(rig, parts, "ledRed", buildLed(0xe23b32, 0.05), LAYOUT.ledRed, false);
    placePart(rig, parts, "buzzer", buildBuzzer(), LAYOUT.buzzer, false);
    placePart(rig, parts, "trim", buildTrim(), LAYOUT.trim, false);
    placePart(rig, parts, "supply", buildSupply(), LAYOUT.supply, false);
    const { unit: blower, rotor } = buildBlower();
    blower.position.copy(LAYOUT.motor);
    rig.add(blower);
    parts.motor = blower;
    parts.fan = rotor;
    rig.add(buildHarness());
    const loader = new GLTFLoader();
    const loadModel = async (key, entry) => {
        const gltf = await loader.loadAsync(entry.url);
        const root = gltf.scene;
        const bounds = new THREE.Box3().setFromObject(root);
        const dims = new THREE.Vector3();
        bounds.getSize(dims);
        const centre = new THREE.Vector3();
        bounds.getCenter(centre);
        const longest = Math.max(dims.x, dims.y, dims.z) || 1;
        const k = entry.longestDimCm / longest;
        root.scale.setScalar(k);
        root.position.sub(centre.multiplyScalar(k));
        root.rotation.set(...entry.rotation);
        root.position.add(new THREE.Vector3(...entry.position));
        const settled = new THREE.Box3().setFromObject(root);
        root.position.y -= settled.min.y;
        rig.add(root);
        parts[key] = root;
    };
    const modelLoads = Object.entries(MODELS_3D).map(async ([key, entry]) => {
        try {
            await loadModel(key, entry);
        }
        catch (err) {
            console.error(`Digital twin failed to load ${key}`, err);
            throw err;
        }
    });
    const fitToHost = () => {
        const w = host?.clientWidth ?? width;
        const h = host?.clientHeight ?? height;
        if (w === 0 || h === 0)
            return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(fitToHost);
    if (host)
        observer.observe(host);
    window.addEventListener("resize", fitToHost);
    fitToHost();
    const alarmFx = new AlarmFx(parts);
    const clock = new THREE.Clock();
    let fanDuty = 150;
    let benchAlarm = false;
    let channelAlarm = false;
    let spin = 6;
    const frame = () => {
        const dt = Math.min(clock.getDelta(), 0.05);
        const elapsed = clock.getElapsedTime();
        const alarmOn = benchAlarm || channelAlarm;
        const targetSpin = (Math.max(0, Math.min(255, fanDuty)) / 255) * 14;
        spin += (targetSpin - spin) * Math.min(1, dt * 3);
        rotor.rotation.z -= dt * spin;
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 8);
        paintLamp(parts.ledGreen, alarmOn ? 0.04 : 0.9);
        paintLamp(parts.ledAmber, parts.ledAmber?.userData.idle ?? 0.18);
        paintLamp(parts.ledRed, alarmOn ? 0.7 + pulse * 1.5 : 0.05);
        paintLamp(parts.buzzer, alarmOn ? 0.35 + pulse * 1.1 : 0);
        if (parts.buzzer) {
            const s = alarmOn ? 1 + pulse * 0.06 : 1;
            parts.buzzer.scale.set(s, s, s);
        }
        alarmFx.update(elapsed);
        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(frame);
    };
    frame();
    onProgress("LOADING MODELS…");
    const settled = await Promise.allSettled(modelLoads);
    const failed = settled.filter((result) => result.status === "rejected").length;
    onProgress(failed === 0 ? "LIVE" : `LIVE · ${failed} MODEL${failed === 1 ? "" : "S"} MISSING`);
    return {
        setStatus(label) { onProgress(label); },
        parts,
        setSensorFailure(sensorId, isFailing) {
            if (sensorId === "spa")
                alarmFx.set("spa", isFailing);
            if (sensorId === "buzzer")
                channelAlarm = isFailing;
        },
        setBenchState(state) {
            if (typeof state.fan === "number" && Number.isFinite(state.fan))
                fanDuty = state.fan;
            if (typeof state.alarm === "boolean")
                benchAlarm = state.alarm;
        },
    };
}
