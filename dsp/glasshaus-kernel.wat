;; GlassHaus exact Float64 modal pair kernel (strict SIMD; no fast-math).
;; Fixed 64 KiB, no imports/growth/allocation. Lane 0 then lane 1 are summed in
;; the original modal order; independent split modes do not exchange energy.
;; ABI: envelopes[128] at byte 0, pitch[128] at 1024, voice sum[128] at 2048.
;; At 3072: fourteen v128 pairs: x,y,cx,cy,c,s,radius,base,tc,ts,targetBase,
;; driveBase,frictionSpeed,dt. run(first,end,vibrato) updates x/y/cx/cy + sums.
;; A missing odd partner is silent. Contact/vibrato math matches the scalar
;; reference, including normalization, damping and the radial safety ceiling.
(module
 (memory (export "memory") 1 1)
 (func (export "run") (param $k i32) (param $end i32) (param $vib i32)
  (local $x v128) (local $y v128) (local $cx v128) (local $cy v128)
  (local $bc v128) (local $bs v128) (local $r v128) (local $base v128) (local $tc v128) (local $ts v128)
  (local $targetBase v128) (local $driveBase v128) (local $speed v128) (local $dt v128)
  (local $c v128) (local $sn v128) (local $delta v128) (local $inv v128) (local $xx v128) (local $yy v128)
  (local $contact f64) (local $energy v128) (local $target v128) (local $drive v128) (local $gain v128) (local $next v128) (local $scale v128) (local $offset i32)
  (local.set $x (v128.load (i32.const 3072))) (local.set $y (v128.load (i32.const 3088)))
  (local.set $cx (v128.load (i32.const 3104))) (local.set $cy (v128.load (i32.const 3120)))
  (local.set $bc (v128.load (i32.const 3136))) (local.set $bs (v128.load (i32.const 3152)))
  (local.set $r (v128.load (i32.const 3168))) (local.set $base (v128.load (i32.const 3184)))
  (local.set $tc (v128.load (i32.const 3200))) (local.set $ts (v128.load (i32.const 3216)))
  (local.set $targetBase (v128.load (i32.const 3232))) (local.set $driveBase (v128.load (i32.const 3248)))
  (local.set $speed (v128.load (i32.const 3264))) (local.set $dt (v128.load (i32.const 3280)))
  (block $done (loop $loop
   (br_if $done (i32.ge_u (local.get $k) (local.get $end)))
   (local.set $offset (i32.shl (local.get $k) (i32.const 3)))
   (local.set $c (local.get $bc)) (local.set $sn (local.get $bs))
   (if (local.get $vib) (then
    (local.set $delta (f64x2.mul (local.get $base) (f64x2.sub (v128.load64_splat (i32.add (i32.const 1024) (local.get $offset))) (v128.const f64x2 1 1))))
    (local.set $c (f64x2.sub (local.get $bc) (f64x2.mul (local.get $bs) (local.get $delta))))
    (local.set $sn (f64x2.add (local.get $bs) (f64x2.mul (local.get $bc) (local.get $delta))))
    (local.set $inv (f64x2.div (v128.const f64x2 1 1) (f64x2.sqrt (f64x2.add (f64x2.mul (local.get $c) (local.get $c)) (f64x2.mul (local.get $sn) (local.get $sn))))))
    (local.set $c (f64x2.mul (local.get $c) (local.get $inv))) (local.set $sn (f64x2.mul (local.get $sn) (local.get $inv)))
   ))
   (local.set $xx (f64x2.mul (f64x2.sub (f64x2.mul (local.get $c) (local.get $x)) (f64x2.mul (local.get $sn) (local.get $y))) (local.get $r)))
   (local.set $yy (f64x2.mul (f64x2.add (f64x2.mul (local.get $sn) (local.get $x)) (f64x2.mul (local.get $c) (local.get $y))) (local.get $r)))
   (local.set $contact (f64.load (local.get $offset)))
   (if (f64.gt (local.get $contact) (f64.const 0.0000001)) (then
    (local.set $energy (f64x2.add (f64x2.mul (local.get $xx) (local.get $xx)) (f64x2.mul (local.get $yy) (local.get $yy))))
    (local.set $target (f64x2.mul (local.get $targetBase) (f64x2.add (v128.const f64x2 0.25 0.25) (f64x2.mul (f64x2.mul (v128.const f64x2 0.75 0.75) (local.get $cx)) (local.get $cx)))))
    (local.set $drive (f64x2.mul (f64x2.mul (f64x2.mul (local.get $driveBase) (f64x2.splat (local.get $contact))) (local.get $speed)) (f64x2.add (v128.const f64x2 0.15 0.15) (f64x2.mul (f64x2.mul (v128.const f64x2 0.85 0.85) (local.get $cx)) (local.get $cx)))))
    (local.set $gain (f64x2.add (v128.const f64x2 1 1) (f64x2.mul (f64x2.max (v128.const f64x2 -120 -120) (f64x2.mul (local.get $drive) (f64x2.sub (v128.const f64x2 1 1) (f64x2.div (local.get $energy) (f64x2.add (f64x2.mul (local.get $target) (local.get $target)) (v128.const f64x2 0.000000001 0.000000001)))))) (local.get $dt))))
    (local.set $xx (f64x2.mul (local.get $xx) (local.get $gain))) (local.set $yy (f64x2.mul (local.get $yy) (local.get $gain)))
   ))
   (local.set $next (f64x2.sub (f64x2.mul (local.get $cx) (local.get $tc)) (f64x2.mul (local.get $cy) (local.get $ts))))
   (local.set $cy (f64x2.add (f64x2.mul (local.get $cy) (local.get $tc)) (f64x2.mul (local.get $cx) (local.get $ts)))) (local.set $cx (local.get $next))
   (local.set $energy (f64x2.add (f64x2.mul (local.get $xx) (local.get $xx)) (f64x2.mul (local.get $yy) (local.get $yy))))
   (if (v128.any_true (f64x2.gt (local.get $energy) (v128.const f64x2 4 4))) (then
    (local.set $scale (f64x2.div (v128.const f64x2 2 2) (f64x2.sqrt (local.get $energy))))
    (local.set $scale (v128.bitselect (local.get $scale) (v128.const f64x2 1 1) (f64x2.gt (local.get $energy) (v128.const f64x2 4 4))))
    (local.set $xx (f64x2.mul (local.get $xx) (local.get $scale))) (local.set $yy (f64x2.mul (local.get $yy) (local.get $scale)))
   ))
   (local.set $x (local.get $xx)) (local.set $y (local.get $yy))
   (f64.store (i32.add (i32.const 2048) (local.get $offset)) (f64.add (f64.add (f64.load (i32.add (i32.const 2048) (local.get $offset))) (f64x2.extract_lane 0 (local.get $x))) (f64x2.extract_lane 1 (local.get $x))))
   (local.set $k (i32.add (local.get $k) (i32.const 1))) (br $loop)
  ))
  (v128.store (i32.const 3072) (local.get $x)) (v128.store (i32.const 3088) (local.get $y))
  (v128.store (i32.const 3104) (local.get $cx)) (v128.store (i32.const 3120) (local.get $cy))
 )
)
