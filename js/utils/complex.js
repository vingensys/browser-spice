class Complex {
    constructor(re = 0, im = 0) {
        this.re = re;
        this.im = im;
    }

    add(z) {
        return new Complex(
            this.re + z.re,
            this.im + z.im
        );
    }

    sub(z) {
        return new Complex(
            this.re - z.re,
            this.im - z.im
        );
    }

    mul(z) {
        return new Complex(
            this.re * z.re - this.im * z.im,
            this.re * z.im + this.im * z.re
        );
    }

    div(z) {
        const denominator = z.re * z.re + z.im * z.im;

        if (denominator === 0) {
            throw new Error("Complex division by zero");
        }

        return new Complex(
            (this.re * z.re + this.im * z.im) / denominator,
            (this.im * z.re - this.re * z.im) / denominator
        );
    }

    scale(k) {
        return new Complex(
            this.re * k,
            this.im * k
        );
    }

    conjugate() {
        return new Complex(this.re, -this.im);
    }

    magnitude() {
        return Math.hypot(this.re, this.im);
    }

    phase() {
        return Math.atan2(this.im, this.re);
    }

    phaseDegrees() {
        return this.phase() * 180 / Math.PI;
    }

    toPolar() {
        return {
            magnitude: this.magnitude(),
            phase: this.phaseDegrees()
        };
    }

    toString(precision = 6) {
        const re = this.re.toFixed(precision);
        const im = Math.abs(this.im).toFixed(precision);

        if (this.im >= 0) {
            return `${re} + j${im}`;
        }

        return `${re} - j${im}`;
    }

    static polar(magnitude, phaseDegrees) {
        const phase = phaseDegrees * Math.PI / 180;

        return new Complex(
            magnitude * Math.cos(phase),
            magnitude * Math.sin(phase)
        );
    }

    static zero() {
        return new Complex(0, 0);
    }

    static one() {
        return new Complex(1, 0);
    }
}