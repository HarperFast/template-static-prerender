/**
 * A fixed-size circular queue (FIFO) for storing elements up to a given capacity.
 *
 * This implementation:
 * - Uses a head/tail pointer to wrap around the underlying array.
 * - Discards enqueue attempts when the buffer is full (returns `false`).
 * - Returns `null` on dequeue when the buffer is empty.
 *
 * @typeParam T The type of element stored in the buffer.
 */
export class RingBuffer<T> {
	protected _head: number = 0;

	protected _tail: number = 0;

	protected _size: number = 0;

	readonly capacity: number;

	protected array: (T | null)[];

	constructor(capacity: number) {
		if (capacity < 1) {
			throw new Error('Capacity must be greater than 0');
		}

		this.capacity = capacity;
		this.array = new Array(capacity).fill(null);
	}

	/**
	 * Adds an element to the tail of the buffer.
	 * @param {T} job - The element to enqueue.
	 * @returns {boolean} - `true` if enqueued successfully, `false` if the buffer is full.
	 */
	enqueue(job: T): boolean {
		if (this._size === this.capacity) {
			return false;
		}

		this.array[this._tail] = job;
		this._tail = (this._tail + 1) % this.capacity;
		this._size++;

		return true;
	}

	/**
	 * Removes and returns the element at the head of the buffer.
	 * @returns {T|null} - The dequeued element, or `null` if the buffer is empty.
	 */
	dequeue(): T | null {
		if (this._size === 0) {
			return null;
		}
		const value = this.array[this._head];
		this._head = (this._head + 1) % this.capacity;
		this._size--;

		return value;
	}

	/**
	 * The current number of elements in the buffer.
	 */
	get size() {
		return this._size;
	}

	/**
	 * The number of available slots before the buffer is full.
	 */
	get space() {
		return this.capacity - this._size;
	}
}
